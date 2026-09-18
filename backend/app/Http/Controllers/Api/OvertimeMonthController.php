<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\OvertimeMonth;
use App\Services\OvertimePayPeriod;
use Illuminate\Http\Request;

/**
 * Read-only ledger over payroll periods (27 -> 26, see OvertimePayPeriod and
 * OvertimeMonth/OvertimeLedgerService) — a period's earned days are paid
 * automatically once the payroll calendar moves past it
 * (OvertimeMonth::isPaid()), so there is nothing to write here.
 */
class OvertimeMonthController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = OvertimeMonth::with(['employee', 'site']);
        $this->scopeToSite($query, $request);

        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }
        // ?month=YYYY-MM — a period is referred to by the month it CLOSES
        // in, e.g. "2026-09" means the 27/08-26/09 period (month = 2026-09-26).
        // Lets a responsable/SuperAdmin browse a specific past period's
        // ledger (history/verification), instead of only ever seeing every
        // period for every matching employee at once.
        if ($month = $request->query('month')) {
            [, $periodEnd] = OvertimePayPeriod::boundsForYearMonth($month);
            $query->whereDate('month', $periodEnd);
        }
        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
        }
        if ($request->query('unpaid_only')) {
            $query->where('days_earned', '>', 0)->where('month', '>=', OvertimePayPeriod::endForDate(now()));
        }

        return $query->orderByDesc('month')->orderBy('employee_id')->paginate($request->integer('per_page', 50));
    }
}
