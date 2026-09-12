<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Assignment;
use App\Models\Employee;
use App\Models\EmployeeExit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ExitController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = EmployeeExit::with(['employee', 'site', 'department', 'position']);
        $this->scopeToSite($query, $request);

        if ($search = $request->query('search')) {
            $query->where('full_name', 'like', "%{$search}%");
        }

        return $query->orderByDesc('exit_date')->paginate($request->integer('per_page', 15));
    }

    /**
     * If employee_id is given, position/department/site/entry_date are pulled
     * from the existing employee record rather than re-entered — and the
     * employee is flagged "sorti" without ever deleting their history.
     */
    public function store(Request $request)
    {
        $data = $request->validate([
            'employee_id' => ['nullable', 'exists:employees,id'],
            'full_name' => ['required_without:employee_id', 'nullable', 'string', 'max:255'],
            'position_id' => ['nullable', 'exists:positions,id'],
            'entry_date' => ['nullable', 'date'],
            'exit_date' => ['required', 'date'],
            'reason' => ['nullable', 'string'],
        ]);

        return DB::transaction(function () use ($data, $request) {
            $employee = null;

            if (! empty($data['employee_id'])) {
                $employee = Employee::findOrFail($data['employee_id']);
                $this->ensureSiteAccess($request, $employee->site_id);

                $exit = EmployeeExit::create([
                    'employee_id' => $employee->id,
                    'full_name' => $employee->full_name,
                    'position_id' => $employee->position_id,
                    'department_id' => $employee->department_id,
                    'site_id' => $employee->site_id,
                    'entry_date' => $employee->entry_date,
                    'exit_date' => $data['exit_date'],
                    'reason' => $data['reason'] ?? null,
                    'created_by' => $request->user()->id,
                ]);

                $employee->update(['status' => 'sorti', 'exit_date' => $data['exit_date']]);
                $this->closeCurrentAssignment($employee, $data['exit_date']);
            } else {
                $siteId = $this->resolveSiteId($request);

                $exit = EmployeeExit::create([
                    'full_name' => $data['full_name'],
                    'position_id' => $data['position_id'] ?? null,
                    'site_id' => $siteId,
                    'entry_date' => $data['entry_date'] ?? null,
                    'exit_date' => $data['exit_date'],
                    'reason' => $data['reason'] ?? null,
                    'created_by' => $request->user()->id,
                ]);
            }

            return response()->json($exit->load(['employee', 'site', 'department', 'position']), 201);
        });
    }

    /**
     * Corrects a mistaken exit record (wrong date/reason typed in). A
     * responsable may fix their own site's records — only the caisse
     * reserves edits to the SuperAdmin.
     */
    public function update(Request $request, EmployeeExit $exit)
    {
        $this->ensureSiteAccess($request, $exit->site_id);

        $data = $request->validate([
            'full_name' => ['required', 'string', 'max:255'],
            'position_id' => ['nullable', 'exists:positions,id'],
            'entry_date' => ['nullable', 'date'],
            'exit_date' => ['required', 'date'],
            'reason' => ['nullable', 'string'],
        ]);

        $exit->update($data);

        if ($exit->employee_id) {
            $exit->employee->update(['exit_date' => $data['exit_date']]);
        }

        return $exit->load(['employee', 'site', 'department', 'position']);
    }

    /**
     * Undoes a mistaken "sortie": removes the exit record and, if it was
     * tied to an employee, restores them to "actif" rather than leaving them
     * incorrectly flagged as having left.
     */
    public function destroy(Request $request, EmployeeExit $exit)
    {
        $this->ensureSiteAccess($request, $exit->site_id);

        return DB::transaction(function () use ($exit) {
            if ($exit->employee_id && $exit->employee?->status === 'sorti') {
                $this->reopenCurrentAssignment($exit->employee, $exit->exit_date);
                $exit->employee->update(['status' => 'actif', 'exit_date' => null]);
            }

            $exit->delete();

            return response()->json(['message' => 'Sortie supprimée.']);
        });
    }

    /**
     * A departing employee's current assignment must stop reading "actif" on
     * the Affectations page once they've left — close it out (is_current
     * false, end_date = exit date) the same moment the exit is recorded,
     * whether typed here directly or auto-generated by a "STC" absence
     * cause in Pointage (see AttendanceController::recordStcExit).
     */
    protected function closeCurrentAssignment(Employee $employee, string $exitDate): void
    {
        Assignment::where('employee_id', $employee->id)
            ->where('is_current', true)
            ->update(['is_current' => false, 'end_date' => $exitDate]);
    }

    /**
     * Undoes closeCurrentAssignment() when an exit record is deleted by
     * mistake — reopens the assignment that was closed on that exact exit
     * date, mirroring the employee status revert just above.
     */
    protected function reopenCurrentAssignment(Employee $employee, $exitDate): void
    {
        Assignment::where('employee_id', $employee->id)
            ->where('is_current', false)
            ->whereDate('end_date', $exitDate)
            ->orderByDesc('start_date')
            ->first()
            ?->update(['is_current' => true, 'end_date' => null]);
    }
}
