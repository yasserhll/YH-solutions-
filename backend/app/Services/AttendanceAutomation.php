<?php

namespace App\Services;

use App\Models\Attendance;
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
    /**
     * employeeId => ['cause' => ..., 'description' => ...], for every
     * employee in $employeeIds with an active period covering $date. Carries
     * the period's own note through (Illness `description`, Suspension
     * `description` falling back to `reason`, Leave `reason`) — this used to
     * only return the bare cause string, which meant AttendanceController::
     * daily() could never show what was actually typed when the period was
     * declared, always rendering an empty Description column for an
     * auto-derived row.
     */
    public static function causesForDate(array $employeeIds, string $date): array
    {
        if (empty($employeeIds)) {
            return [];
        }

        $causes = [];

        Suspension::whereIn('employee_id', $employeeIds)
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->get(['employee_id', 'reason', 'description'])
            ->each(function ($s) use (&$causes) {
                $causes[$s->employee_id] = ['cause' => 'mise_a_pied', 'description' => $s->description ?? $s->reason];
            });

        Leave::whereIn('employee_id', $employeeIds)
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->get(['employee_id', 'reason'])
            ->each(function ($l) use (&$causes) {
                $causes[$l->employee_id] = ['cause' => 'conge', 'description' => $l->reason];
            });

        Illness::whereIn('employee_id', $employeeIds)
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->get(['employee_id', 'description'])
            ->each(function ($i) use (&$causes) {
                $causes[$i->employee_id] = ['cause' => 'maladie', 'description' => $i->description];
            });

        return $causes;
    }

    /**
     * A real Attendance row always wins over the auto-derived default (see
     * causesForDate/daily()) — that's deliberate, it's what lets a
     * responsable correct a specific day after the fact. But that same rule
     * turns into a bug when the conflicting row PREDATES the period: e.g. an
     * employee is pointed "présent" on the 17th, then a Maladie covering the
     * 17th-19th gets declared afterward — without this, Pointage keeps
     * showing that stale "présent" forever, even though the period the
     * responsable just declared clearly says otherwise for that date. Call
     * this right after creating/updating/extending a period so any row it
     * now supersedes stops shadowing it; a row a responsable enters
     * AFTERWARDS (a deliberate, later correction) is untouched since this
     * only runs once, at declaration time.
     *
     * Never touches an "stc" row: that absence cause carries a real side
     * effect (auto-creates an Exit and flips the employee to "sorti"), which
     * must always be undone through RevertsEmployeeDeparture, never silently
     * deleted here.
     */
    public static function reconcilePeriod(int $employeeId, string $startDate, string $endDate): void
    {
        Attendance::where('employee_id', $employeeId)
            ->whereDate('date', '>=', $startDate)
            ->whereDate('date', '<=', $endDate)
            ->where(function ($query) {
                $query->whereNull('absence_cause')->orWhere('absence_cause', '!=', 'stc');
            })
            ->delete();
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
                        // The period record itself carries the actual note
                        // (Illness only has `description`, Suspension has
                        // both, Leave only has `reason`) — this used to be
                        // hardcoded to null, silently dropping whatever the
                        // responsable typed when declaring the period on
                        // every day the daily sheet/Rapports/fiche derive
                        // from it instead of a real Attendance row.
                        'description' => $period->description ?? $period->reason ?? null,
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
