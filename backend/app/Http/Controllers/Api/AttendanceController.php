<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreAttendanceRequest;
use App\Models\Assignment;
use App\Models\Attendance;
use App\Models\Employee;
use App\Models\EmployeeExit;
use App\Models\Holiday;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
        }

        return $query->orderByDesc('date')->paginate($request->integer('per_page', 20));
    }

    /**
     * Daily sheet: every employee of the scoped site(s) for a given date.
     * The default status for an employee with no explicit record on that
     * date depends on the day type: a normal Monday-Saturday day defaults
     * to "present" (so a responsable only has to key in the exceptions —
     * the absent people); a Sunday or a declared holiday flips the default
     * to "absent" (so instead they only key in the exceptions — the people
     * who actually came in). A holiday always wins over the weekday rule
     * even if it falls on a day that would otherwise be worked. Rows are
     * sorted absent-first (then present), so the people who need attention
     * today aren't buried below a long list of already-present employees.
     */
    public function daily(Request $request)
    {
        $date = $request->query('date', now()->toDateString());
        $search = $request->query('search');
        $statusFilter = $request->query('status'); // 'present' | 'absent' | null (= tous)

        $holiday = Holiday::whereDate('date', $date)->first();
        $dayType = $holiday ? 'holiday' : (Carbon::parse($date)->isSunday() ? 'sunday' : 'normal');
        $defaultStatus = $dayType === 'normal' ? 'present' : 'absent';

        // A "sorti" employee still belongs on the sheet for their exit date and every
        // day before it (their history, including the STC day itself, must stay
        // visible) — only dates strictly after their exit_date drop them, since
        // that's the point where they're no longer part of the workforce.
        $employeesQuery = Employee::where(function ($q) use ($date) {
            $q->where('status', 'actif')
                ->orWhere(function ($q2) use ($date) {
                    $q2->where('status', 'sorti')->whereDate('exit_date', '>=', $date);
                });
        })->with('site');
        $this->scopeToSite($employeesQuery, $request);
        if ($search) {
            $employeesQuery->where('full_name', 'like', "%{$search}%");
        }
        $employees = $employeesQuery->orderBy('full_name')->get();

        $attendances = Attendance::whereDate('date', $date)
            ->whereIn('employee_id', $employees->pluck('id'))
            ->get()
            ->keyBy('employee_id');

        $rows = $employees->map(function (Employee $employee) use ($attendances, $date, $defaultStatus) {
            $attendance = $attendances->get($employee->id);

            return [
                'employee_id' => $employee->id,
                'full_name' => $employee->full_name,
                'site' => $employee->site->name,
                'date' => $date,
                'attendance_id' => $attendance?->id,
                'status' => $attendance?->status ?? $defaultStatus,
                'absence_cause' => $attendance?->absence_cause,
                'description' => $attendance?->description,
            ];
        });

        if (in_array($statusFilter, ['present', 'absent'], true)) {
            $rows = $rows->where('status', $statusFilter);
        }

        // On a normal day almost everyone is present, so surfacing the few
        // absences first is what needs attention. On a Sunday/holiday it's
        // the reverse — almost everyone is absent by default, so the few
        // people who actually showed up (marked present) belong on top.
        $prioritizedStatus = $defaultStatus === 'present' ? 'absent' : 'present';
        $rows = $rows
            ->sortBy([
                fn ($a, $b) => ($b['status'] === $prioritizedStatus) <=> ($a['status'] === $prioritizedStatus),
                fn ($a, $b) => $a['full_name'] <=> $b['full_name'],
            ])
            ->values();

        return response()->json([
            'day_type' => $dayType,
            'holiday_id' => $holiday?->id,
            'holiday_name' => $holiday?->name,
            'rows' => $rows,
        ]);
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

        $attendance = DB::transaction(function () use ($data, $employee, $request) {
            $attendance = Attendance::updateOrCreate(
                ['employee_id' => $data['employee_id'], 'date' => $data['date']],
                $data
            );

            if ($data['status'] === 'absent' && $data['absence_cause'] === 'stc') {
                $this->recordStcExit($employee, $data['date'], $request);
            }

            return $attendance;
        });

        return response()->json($attendance->load(['employee', 'site']), 201);
    }

    /**
     * STC ("solde tout compte") marks the employee's final departure: the
     * date entered becomes their exit_date, an EmployeeExit row is created
     * so they show up under Entrées/Sorties, and their status flips to
     * "sorti" so the daily sheet (which only lists status=actif employees)
     * stops listing them from the following day onward. Every attendance
     * row already on file — before and on the STC date — is left untouched.
     */
    private function recordStcExit(Employee $employee, string $date, Request $request): void
    {
        if ($employee->status === 'sorti') {
            return;
        }

        EmployeeExit::create([
            'employee_id' => $employee->id,
            'full_name' => $employee->full_name,
            'position_id' => $employee->position_id,
            'department_id' => $employee->department_id,
            'site_id' => $employee->site_id,
            'entry_date' => $employee->entry_date,
            'exit_date' => $date,
            'reason' => 'STC',
            'created_by' => $request->user()->id,
        ]);

        $employee->update(['status' => 'sorti', 'exit_date' => $date]);

        // The Affectations page reads "actif" straight off the assignment's
        // is_current flag, not the employee's own status — without this it
        // would keep showing a departed employee's affectation as active.
        Assignment::where('employee_id', $employee->id)
            ->where('is_current', true)
            ->update(['is_current' => false, 'end_date' => $date]);
    }

    public function bulkStore(Request $request)
    {
        $data = $request->validate([
            'date' => ['required', 'date'],
            'employee_ids' => ['required', 'array', 'min:1'],
            'employee_ids.*' => ['exists:employees,id'],
            'status' => ['required', Rule::in(['present', 'absent'])],
            'absence_cause' => ['required_if:status,absent', 'nullable', Rule::in(['maladie', 'autorisee', 'non_autorisee', 'conge', 'mise_a_pied', 'stc'])],
            'description' => ['nullable', 'string'],
        ]);

        $employees = Employee::whereIn('id', $data['employee_ids'])->get();

        foreach ($employees as $employee) {
            $this->ensureSiteAccess($request, $employee->site_id);
        }

        $results = DB::transaction(function () use ($employees, $data, $request) {
            return $employees->map(function (Employee $employee) use ($data, $request) {
                $attendance = Attendance::updateOrCreate(
                    ['employee_id' => $employee->id, 'date' => $data['date']],
                    [
                        'site_id' => $employee->site_id,
                        'status' => $data['status'],
                        'absence_cause' => $data['status'] === 'absent' ? $data['absence_cause'] : null,
                        'description' => $data['description'] ?? null,
                        'created_by' => $request->user()->id,
                    ]
                );

                if ($data['status'] === 'absent' && $data['absence_cause'] === 'stc') {
                    $this->recordStcExit($employee, $data['date'], $request);
                }

                return $attendance;
            });
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

        DB::transaction(function () use ($data, $attendance, $request) {
            $attendance->update($data);

            if ($data['status'] === 'absent' && $data['absence_cause'] === 'stc') {
                $this->recordStcExit($attendance->employee, $data['date'], $request);
            }
        });

        return $attendance->load(['employee', 'site']);
    }

    public function destroy(Request $request, Attendance $attendance)
    {
        $this->ensureSiteAccess($request, $attendance->site_id);
        $attendance->delete();

        return response()->json(['message' => 'Pointage supprimé.']);
    }
}
