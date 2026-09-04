<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreAttendanceRequest;
use App\Models\Attendance;
use App\Models\Employee;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AttendanceController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = Attendance::with(['employee', 'site']);
        $this->scopeToSite($query, $request);

        $date = $request->query('date');
        $from = $request->query('date_from');
        $to = $request->query('date_to');

        if ($date) {
            $query->whereDate('date', $date);
        } elseif ($from && $to) {
            $query->whereBetween('date', [$from, $to]);
        }

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($cause = $request->query('absence_cause')) {
            $query->where('absence_cause', $cause);
        }

        return $query->orderByDesc('date')->paginate($request->integer('per_page', 20));
    }

    /**
     * Daily sheet: every employee of the scoped site(s) for a given date,
     * defaulting to "present" when no record exists yet for that day.
     */
    public function daily(Request $request)
    {
        $date = $request->query('date', now()->toDateString());

        $employeesQuery = Employee::where('status', 'actif')->with('site');
        $this->scopeToSite($employeesQuery, $request);
        $employees = $employeesQuery->orderBy('full_name')->get();

        $attendances = Attendance::whereDate('date', $date)
            ->whereIn('employee_id', $employees->pluck('id'))
            ->get()
            ->keyBy('employee_id');

        return $employees->map(function (Employee $employee) use ($attendances, $date) {
            $attendance = $attendances->get($employee->id);

            return [
                'employee_id' => $employee->id,
                'full_name' => $employee->full_name,
                'site' => $employee->site->name,
                'date' => $date,
                'attendance_id' => $attendance?->id,
                'status' => $attendance?->status ?? 'present',
                'absence_cause' => $attendance?->absence_cause,
                'description' => $attendance?->description,
            ];
        });
    }

    public function store(StoreAttendanceRequest $request)
    {
        $employee = Employee::findOrFail($request->validated('employee_id'));
        $this->ensureSiteAccess($request, $employee->site_id);

        $data = $request->validated();
        $data['site_id'] = $employee->site_id;
        $data['created_by'] = $request->user()->id;
        if ($data['status'] === 'present') {
            $data['absence_cause'] = null;
            $data['description'] = null;
        }

        $attendance = Attendance::updateOrCreate(
            ['employee_id' => $data['employee_id'], 'date' => $data['date']],
            $data
        );

        return response()->json($attendance->load(['employee', 'site']), 201);
    }

    public function bulkStore(Request $request)
    {
        $data = $request->validate([
            'date' => ['required', 'date'],
            'employee_ids' => ['required', 'array', 'min:1'],
            'employee_ids.*' => ['exists:employees,id'],
            'status' => ['required', Rule::in(['present', 'absent'])],
            'absence_cause' => ['required_if:status,absent', 'nullable', Rule::in(['maladie', 'autorisee', 'non_autorisee', 'justifie', 'conge'])],
            'description' => ['nullable', 'string'],
        ]);

        $employees = Employee::whereIn('id', $data['employee_ids'])->get();

        foreach ($employees as $employee) {
            $this->ensureSiteAccess($request, $employee->site_id);
        }

        $results = $employees->map(function (Employee $employee) use ($data, $request) {
            return Attendance::updateOrCreate(
                ['employee_id' => $employee->id, 'date' => $data['date']],
                [
                    'site_id' => $employee->site_id,
                    'status' => $data['status'],
                    'absence_cause' => $data['status'] === 'absent' ? $data['absence_cause'] : null,
                    'description' => $data['description'] ?? null,
                    'created_by' => $request->user()->id,
                ]
            );
        });

        return response()->json($results, 201);
    }

    public function update(StoreAttendanceRequest $request, Attendance $attendance)
    {
        $this->ensureSiteAccess($request, $attendance->site_id);

        $data = $request->validated();
        if ($data['status'] === 'present') {
            $data['absence_cause'] = null;
            $data['description'] = null;
        }
        $attendance->update($data);

        return $attendance->load(['employee', 'site']);
    }

    public function destroy(Request $request, Attendance $attendance)
    {
        $this->ensureSiteAccess($request, $attendance->site_id);
        $attendance->delete();

        return response()->json(['message' => 'Pointage supprimé.']);
    }
}
