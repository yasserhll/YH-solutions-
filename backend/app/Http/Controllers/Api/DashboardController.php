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
use App\Models\Leave;
use App\Models\LeaveRequest;
use App\Models\Suspension;
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

        $attendanceToday = $this->scopeToSite(Attendance::query(), $request)->whereDate('date', $today);

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
                'present_today' => (clone $attendanceToday)->where('status', 'present')->count(),
                'absent_today' => (clone $attendanceToday)->where('status', 'absent')->count(),
                'leaves_in_progress' => (clone $leaves)->where('status', 'en_cours')->count(),
                'new_employees_30d' => (clone $employees)->where('entry_date', '>=', now()->subDays(30))->count(),
                'recent_exits_30d' => (clone $exits)->where('exit_date', '>=', now()->subDays(30))->count(),
            ],
            'attendance' => [
                'present' => (clone $attendanceToday)->where('status', 'present')->count(),
                'absent_maladie' => (clone $attendanceToday)->where('absence_cause', 'maladie')->count(),
                'absent_autorisee' => (clone $attendanceToday)->where('absence_cause', 'autorisee')->count(),
                'absent_non_autorisee' => (clone $attendanceToday)->where('absence_cause', 'non_autorisee')->count(),
                'absent_justifie' => (clone $attendanceToday)->where('absence_cause', 'justifie')->count(),
                'absent_conge' => (clone $attendanceToday)->where('absence_cause', 'conge')->count(),
            ],
            'leaves' => [
                'pending' => (clone $leaveRequests)->where('status', 'en_attente')->count(),
                'accepted' => (clone $leaveRequests)->where('status', 'acceptee')->count(),
                'in_progress' => (clone $leaves)->where('status', 'en_cours')->count(),
                'completed' => (clone $leaves)->where('status', 'termine')->count(),
            ],
            'sanctions' => [
                'warnings' => (clone $warnings)->count(),
                'suspensions' => (clone $suspensions)->count(),
            ],
            'cash' => [
                // Master balance: SuperAdmin only, never shown to a responsable.
                // Never reduced by a transfer — only entries/expenses move it.
                'current_balance' => $isSuperAdmin ? round(CashAccount::singleton()->currentBalance(), 2) : null,
                // A responsable's own site's remaining spending limit; SuperAdmin has no single "own site".
                'site_balance' => (! $isSuperAdmin && $request->user()->site_id)
                    ? CashTransaction::currentSiteBalance($request->user()->site_id)
                    : null,
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
