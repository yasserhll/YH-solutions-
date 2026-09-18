<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\OvertimeMonth;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Read-only monthly ledger (see OvertimeMonth/OvertimeLedgerService) — a
 * month's earned days are paid automatically once the calendar moves past
 * that month (OvertimeMonth::isPaid()), so there is nothing to write here.
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
        // ?month=YYYY-MM — lets a responsable/SuperAdmin browse a specific
        // past month's ledger (history/verification), instead of only ever
        // seeing every month for every matching employee at once.
        if ($month = $request->query('month')) {
            $query->whereDate('month', Carbon::parse($month.'-01'));
        }
        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
        }
        if ($request->query('unpaid_only')) {
            $query->where('days_earned', '>', 0)->where('month', '>=', now()->startOfMonth());
        }

        return $query->orderByDesc('month')->orderBy('employee_id')->paginate($request->integer('per_page', 50));
    }
}
