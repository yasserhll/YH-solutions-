<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\OvertimeEntry;
use App\Models\OvertimeMonth;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * 8 overtime hours = 1 payable day. Recomputes an employee's ENTIRE ledger
 * from their raw `overtime_entries` every time one changes — exactly like
 * CashLedgerService recomputes running balances on every transaction write,
 * for the same reason: the derived numbers (days earned, hours carried to
 * the next period) must never be able to drift from the source data.
 *
 * Buckets entries by PAYROLL PERIOD (27 -> 26, see OvertimePayPeriod), not
 * by calendar month — a declaration on 26 September belongs to the period
 * ending that day, one on 27 September already belongs to the next period.
 *
 * Walks every period from the employee's earliest declaration up to "now"
 * (even periods with zero new hours declared) so a carry-over never gets
 * stuck waiting for the next declaration to exist — see the worked example
 * in CLAUDE.md.
 */
class OvertimeLedgerService
{
    public function recalculate(Employee $employee): void
    {
        $entriesByPeriod = OvertimeEntry::where('employee_id', $employee->id)
            ->get()
            ->groupBy(fn (OvertimeEntry $e) => OvertimePayPeriod::endForDate($e->date)->toDateString());

        DB::transaction(function () use ($employee, $entriesByPeriod) {
            // Delete-then-rebuild rather than updateOrCreate-merge: this is
            // fully derived data, and a `month` key from a previous version
            // of this logic (e.g. calendar-month-based rows predating the
            // 27-26 payroll rule) would otherwise never get cleaned up,
            // sitting alongside the correct rows forever instead of being
            // replaced by them.
            OvertimeMonth::where('employee_id', $employee->id)->delete();

            if ($entriesByPeriod->isEmpty()) {
                return;
            }

            $periodEnds = $entriesByPeriod->keys()->sort()->values();
            $cursor = Carbon::parse($periodEnds->first());
            // Extend through to the current period even if the last
            // declaration is older, so an unresolved carry-over stays
            // visible rather than disappearing once nothing new is declared
            // for a while.
            $endCursor = Carbon::parse($periodEnds->last())->max(OvertimePayPeriod::endForDate(now()));

            $carried = '0.00';

            while ($cursor->lte($endCursor)) {
                $key = $cursor->toDateString();
                $declared = (string) ($entriesByPeriod->get($key)?->sum('hours') ?? '0.00');

                $total = bcadd($carried, $declared, 2);
                $daysEarned = (int) bcdiv($total, '8', 0);
                $remaining = bcmod($total, '8', 2);

                OvertimeMonth::create([
                    'employee_id' => $employee->id,
                    'month' => $cursor->toDateString(),
                    'site_id' => $employee->site_id,
                    'carried_hours' => $carried,
                    'declared_hours' => $declared,
                    'total_hours' => $total,
                    'days_earned' => $daysEarned,
                    'remaining_hours' => $remaining,
                ]);

                // Only the leftover hours (<8) ever carry forward — the
                // whole days just computed are considered paid once this
                // period closes (see OvertimeMonth::isPaid()) and are never
                // re-added to the next period's total, so a paid day can
                // never be paid twice.
                $carried = $remaining;
                $cursor->addMonthNoOverflow();
            }
        });
    }
}
