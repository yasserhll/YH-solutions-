<?php

namespace App\Services;

use App\Models\Illness;
use App\Models\Leave;
use App\Models\Suspension;
use Carbon\Carbon;
use Illuminate\Support\Collection;

/**
 * Maladie/Congé/Mise à pied can each be declared once as a date range in
 * their own module (Illness, Leave, Suspension). This service turns "does
 * employee X have an active period on date Y" into an attendance-shaped
 * absence_cause, used as the day's DEFAULT — exactly like the Sunday/holiday
 * default already worked — never as a lock: a real Attendance row always
 * wins over it (see AttendanceController::daily), so a responsable can still
 * mark present/correct the cause manually whenever they want. Used by the
 * daily sheet (AttendanceController::daily), the Rapports/export list
 * (ReportController), and the Dashboard's "today" KPIs.
 *
 * Priority when periods overlap (shouldn't normally happen, but the rule is
 * explicit in the spec): maladie > congé > mise_a_pied. Applied by writing
 * the lowest-priority cause first so a higher-priority one overwrites it.
 */
class AttendanceAutomation
{
    /** employeeId => cause, for every employee in $employeeIds with an active period covering $date. */
    public static function causesForDate(array $employeeIds, string $date): array
    {
        if (empty($employeeIds)) {
            return [];
        }

        $causes = [];

        Suspension::whereIn('employee_id', $employeeIds)
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->pluck('employee_id')
            ->each(function ($id) use (&$causes) { $causes[$id] = 'mise_a_pied'; });

        Leave::whereIn('employee_id', $employeeIds)
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->pluck('employee_id')
            ->each(function ($id) use (&$causes) { $causes[$id] = 'conge'; });

        Illness::whereIn('employee_id', $employeeIds)
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->pluck('employee_id')
            ->each(function ($id) use (&$causes) { $causes[$id] = 'maladie'; });

        return $causes;
    }

    /**
     * Expands every active period overlapping [$from, $to] (either bound may
     * be null = unbounded, since a period's own span is already short) into
     * one synthetic attendance-shaped row per (employee, day) — used for
     * Rapports/exports/dashboard, which look at a range rather than a single
     * day. `$existingKeys` (a set of "employeeId|Y-m-d") lets the caller skip
     * any day already covered by a real Attendance row — that row wins, it
     * isn't duplicated here.
     *
     * Returns a plain array of associative rows shaped like a flattened
     * attendance report line, keyed by "employeeId|date" (priority order —
     * maladie last so it wins on overlap, same as causesForDate above).
     */
    public static function virtualRows(Collection $employeesById, ?string $from, ?string $to, array $existingKeys): array
    {
        $employeeIds = $employeesById->keys()->all();
        if (empty($employeeIds)) {
            return [];
        }

        $rows = [];

        $addPeriods = function (Collection $periods, string $cause) use (&$rows, $employeesById, $from, $to, $existingKeys) {
            foreach ($periods as $period) {
                $employee = $employeesById->get($period->employee_id);
                if (! $employee) {
                    continue;
                }

                $start = $from ? Carbon::parse($period->start_date)->max(Carbon::parse($from)) : Carbon::parse($period->start_date);
                $end = $to ? Carbon::parse($period->end_date)->min(Carbon::parse($to)) : Carbon::parse($period->end_date);

                for ($cursor = $start->copy(); $cursor->lte($end); $cursor->addDay()) {
                    $key = $period->employee_id.'|'.$cursor->toDateString();
                    if (in_array($key, $existingKeys, true)) {
                        continue;
                    }

                    $rows[$key] = [
                        'employee_id' => $period->employee_id,
                        'employee_name' => $employee->full_name,
                        'site_name' => $employee->site?->name,
                        'site_id' => $employee->site_id,
                        'date' => $cursor->toDateString(),
                        'status' => 'absent',
                        'absence_cause' => $cause,
                        'description' => null,
                        'auto' => true,
                    ];
                }
            }
        };

        $overlap = fn ($query) => $query
            ->whereIn('employee_id', $employeeIds)
            ->when($from, fn ($q) => $q->whereDate('end_date', '>=', $from))
            ->when($to, fn ($q) => $q->whereDate('start_date', '<=', $to));

        $addPeriods($overlap(Suspension::query())->get(), 'mise_a_pied');
        $addPeriods($overlap(Leave::query())->get(), 'conge');
        $addPeriods($overlap(Illness::query())->get(), 'maladie');

        return array_values($rows);
    }
}
