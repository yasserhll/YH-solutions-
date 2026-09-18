<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\OvertimeEntry;
use App\Models\OvertimeMonth;
use Carbon\Carbon;

/**
 * 8 overtime hours = 1 payable day. Recomputes an employee's ENTIRE monthly
 * ledger from their raw `overtime_entries` every time one changes — exactly
 * like CashLedgerService recomputes running balances on every transaction
 * write, for the same reason: the derived numbers (days earned, hours
 * carried to next month) must never be able to drift from the source data.
 *
 * Walks every calendar month from the employee's earliest declaration up to
 * "now" (even months with zero new hours declared) so a carry-over never
 * gets stuck waiting for the next declaration to exist — see the worked
 * example in CLAUDE.md.
 */
class OvertimeLedgerService
{
    public function recalculate(Employee $employee): void
    {
        $entriesByMonth = OvertimeEntry::where('employee_id', $employee->id)
            ->get()
            ->groupBy(fn (OvertimeEntry $e) => $e->date->format('Y-m'));

        if ($entriesByMonth->isEmpty()) {
            OvertimeMonth::where('employee_id', $employee->id)->delete();

            return;
        }

        $months = $entriesByMonth->keys()->sort()->values();
        $cursor = Carbon::parse($months->first().'-01');
        // Extend through to the current month even if the last declaration
        // is older, so an unresolved carry-over stays visible rather than
        // disappearing once nothing new is declared for a while.
        $endMonth = Carbon::parse($months->last().'-01')->max(now()->startOfMonth());

        $carried = '0.00';

        while ($cursor->lte($endMonth)) {
            $key = $cursor->format('Y-m');
            $declared = (string) ($entriesByMonth->get($key)?->sum('hours') ?? '0.00');

            $total = bcadd($carried, $declared, 2);
            $daysEarned = (int) bcdiv($total, '8', 0);
            $remaining = bcmod($total, '8', 2);

            OvertimeMonth::updateOrCreate(
                ['employee_id' => $employee->id, 'month' => $cursor->toDateString()],
                [
                    'site_id' => $employee->site_id,
                    'carried_hours' => $carried,
                    'declared_hours' => $declared,
                    'total_hours' => $total,
                    'days_earned' => $daysEarned,
                    'remaining_hours' => $remaining,
                ]
            );

            $carried = $remaining;
            $cursor->addMonthNoOverflow();
        }
    }
}
