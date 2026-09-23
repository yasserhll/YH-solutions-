<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\CashAccount;
use App\Models\CashTransaction;
use App\Models\DisciplinaryWarning;
use App\Models\Employee;
use App\Models\EmployeeExit;
use App\Models\Holiday;
use App\Models\Leave;
use App\Models\LeaveRequest;
use App\Models\Suspension;
use App\Services\AttendanceAutomation;
use App\Services\SiteCashPool;
use Carbon\Carbon;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $today = now()->toDateString();
        $monthStart = now()->startOfMonth()->toDateString();

        $employees = $this->scopeToSite(Employee::query(), $request);
        $activeEmployees = (clone $employees)->where('status', 'actif');
        $activeEmployeeIds = (clone $activeEmployees)->pluck('id')->all();

        // Scoped to active employees only, same population as `total` below —
        // otherwise a same-day STC row (the employee is already `sorti` by
        // the time this runs) could count toward present/absent without
        // counting toward the total, breaking the two-bucket total.
        $attendanceToday = $this->scopeToSite(Attendance::query(), $request)
            ->whereDate('date', $today)
            ->whereIn('employee_id', $activeEmployeeIds);

        // Employees currently in an active Maladie/Congé/Mise à pied period
        // never get a real Attendance row for it any more (see
        // AttendanceAutomation) — fold their auto-derived cause into today's
        // counts too, or the dashboard would silently undercount them.
        $employeesWithRealRowToday = (clone $attendanceToday)->pluck('employee_id')->all();
        $employeesNeedingAuto = array_values(array_diff($activeEmployeeIds, $employeesWithRealRowToday));
        $autoCausesToday = AttendanceAutomation::causesForDate($employeesNeedingAuto, $today);
        $autoCauseCounts = array_count_values(array_column($autoCausesToday, 'cause'));

        // Every active employee lands in present OR absent today — never a
        // third "non pointé" bucket — exactly like AttendanceController::
        // daily()'s own day-type default: présent by default on a normal
        // Monday-Saturday, absent by default on a Sunday or a declared
        // holiday. Anyone with neither a real row nor an auto-derived cause
        // (illness/leave/suspension) falls back to that default so the two
        // counts below always sum to the total.
        $isDefaultAbsentDay = Holiday::whereDate('date', $today)->exists() || Carbon::parse($today)->isSunday();
        $noRecordCount = count($employeesNeedingAuto) - count($autoCausesToday);
        $defaultPresentCount = $isDefaultAbsentDay ? 0 : $noRecordCount;
        $defaultAbsentCount = $isDefaultAbsentDay ? $noRecordCount : 0;

        $leaveRequests = $this->scopeToSite(LeaveRequest::query(), $request);
        $leaves = $this->scopeToSite(Leave::query(), $request);
        $warnings = $this->scopeToSite(DisciplinaryWarning::query(), $request);
        $suspensions = $this->scopeToSite(Suspension::query(), $request);
        $exits = $this->scopeToSite(EmployeeExit::query(), $request);

        $isSuperAdmin = $request->user()->isSuperAdmin();

        $recentOperationsQuery = $this->scopeToSite(CashTransaction::query(), $request)->with('site');
        if (! $isSuperAdmin) {
            // A responsable's dashboard never shows master recharges — only
            // their own site's declared purchases and transfers received.
            $recentOperationsQuery->whereIn('type', ['expense', 'transfer']);
        }
        $recentOperations = $recentOperationsQuery->orderByDesc('date')->orderByDesc('id')->limit(5)->get();
        if (! $isSuperAdmin) {
            $recentOperations->each(fn ($t) => $t->makeHidden('running_balance'));
        }

        return response()->json([
            'personnel' => [
                'total' => (clone $activeEmployees)->count(),
                'present_today' => (clone $attendanceToday)->where('status', 'present')->count() + $defaultPresentCount,
                'absent_today' => (clone $attendanceToday)->where('status', 'absent')->count() + count($autoCausesToday) + $defaultAbsentCount,
                'leaves_in_progress' => (clone $leaves)->inProgress()->count(),
                'new_employees_30d' => (clone $employees)->where('entry_date', '>=', now()->subDays(30))->count(),
                'recent_exits_30d' => (clone $exits)->where('exit_date', '>=', now()->subDays(30))->count(),
            ],
            'attendance' => [
                'present' => (clone $attendanceToday)->where('status', 'present')->count() + $defaultPresentCount,
                'absent_maladie' => (clone $attendanceToday)->where('absence_cause', 'maladie')->count() + ($autoCauseCounts['maladie'] ?? 0),
                'absent_autorisee' => (clone $attendanceToday)->where('absence_cause', 'autorisee')->count(),
                'absent_non_autorisee' => (clone $attendanceToday)->where('absence_cause', 'non_autorisee')->count(),
                'absent_mise_a_pied' => (clone $attendanceToday)->where('absence_cause', 'mise_a_pied')->count() + ($autoCauseCounts['mise_a_pied'] ?? 0),
                'absent_conge' => (clone $attendanceToday)->where('absence_cause', 'conge')->count() + ($autoCauseCounts['conge'] ?? 0),
                'absent_stc' => (clone $attendanceToday)->where('absence_cause', 'stc')->count(),
            ],
            'leaves' => [
                'pending' => (clone $leaveRequests)->where('status', 'en_attente')->count(),
                'accepted' => (clone $leaveRequests)->where('status', 'acceptee')->count(),
                'in_progress' => (clone $leaves)->inProgress()->count(),
                'completed' => (clone $leaves)->finished()->count(),
            ],
            'sanctions' => [
                'warnings' => (clone $warnings)->count(),
                'suspensions' => (clone $suspensions)->count(),
            ],
            'cash' => [
                // Master balance: SuperAdmin only, never shown to a responsable.
                // Never reduced by a transfer — only entries/expenses move it.
                'current_balance' => $isSuperAdmin ? round(CashAccount::singleton()->currentBalance(), 2) : null,
                // Every cash pool covering a responsable's assigned sites
                // (see SiteCashPool) — two sites sharing one responsable's
                // common caisse collapse into a single grouped entry, not
                // two identical numbers. Null for a SuperAdmin, who has no
                // "own sites" (they see the master balance instead).
                'site_balances' => $isSuperAdmin ? null : SiteCashPool::groupedBalances(
                    $request->user()->sites->pluck('id')->all()
                ),
                'expenses_today' => (float) (clone $this->scopeToSite(CashTransaction::query(), $request))
                    ->where('type', 'expense')->whereDate('date', $today)->sum('amount'),
                'expenses_month' => (float) (clone $this->scopeToSite(CashTransaction::query(), $request))
                    ->where('type', 'expense')->where('date', '>=', $monthStart)->sum('amount'),
                'total_expenses' => (float) (clone $this->scopeToSite(CashTransaction::query(), $request))
                    ->where('type', 'expense')->sum('amount'),
                'recent_operations' => $recentOperations,
            ],
        ]);
    }
}
