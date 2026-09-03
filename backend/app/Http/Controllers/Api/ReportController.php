<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\CashTransaction;
use App\Models\DisciplinaryWarning;
use App\Models\Entry;
use App\Models\EmployeeExit;
use App\Models\LeaveRequest;
use App\Models\Suspension;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    use InteractsWithSites;

    protected function applyPeriod(Request $request, $query, string $column = 'date')
    {
        if ($from = $request->query('date_from')) {
            $query->whereDate($column, '>=', $from);
        }
        if ($to = $request->query('date_to')) {
            $query->whereDate($column, '<=', $to);
        }

        return $query;
    }

    public function attendance(Request $request)
    {
        $query = Attendance::with(['employee', 'site']);
        $this->scopeToSite($query, $request);
        $this->applyPeriod($request, $query);

        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($cause = $request->query('absence_cause')) {
            $query->where('absence_cause', $cause);
        }

        return $query->orderByDesc('date')->paginate($request->integer('per_page', 30));
    }

    public function leaves(Request $request)
    {
        $query = LeaveRequest::with(['employee', 'site']);
        $this->scopeToSite($query, $request);
        $this->applyPeriod($request, $query, 'request_date');

        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        return $query->orderByDesc('request_date')->paginate($request->integer('per_page', 30));
    }

    public function sanctions(Request $request)
    {
        $warningsQuery = DisciplinaryWarning::with(['employee', 'site'])->selectRaw("'avertissement' as type, id, employee_id, site_id, date, reason, description");
        $this->scopeToSite($warningsQuery, $request);
        $this->applyPeriod($request, $warningsQuery);

        $suspensionsQuery = Suspension::with(['employee', 'site'])->selectRaw("'mise_a_pied' as type, id, employee_id, site_id, date, reason, description");
        $this->scopeToSite($suspensionsQuery, $request);
        $this->applyPeriod($request, $suspensionsQuery);

        if ($employeeId = $request->query('employee_id')) {
            $warningsQuery->where('employee_id', $employeeId);
            $suspensionsQuery->where('employee_id', $employeeId);
        }

        $type = $request->query('type');

        $warnings = $type === 'mise_a_pied' ? collect() : $warningsQuery->get();
        $suspensions = $type === 'avertissement' ? collect() : $suspensionsQuery->get();

        return $warnings->concat($suspensions)->sortByDesc('date')->values();
    }

    public function movements(Request $request)
    {
        $entriesQuery = Entry::with(['employee', 'site', 'department']);
        $this->scopeToSite($entriesQuery, $request);
        $this->applyPeriod($request, $entriesQuery, 'entry_date');

        $exitsQuery = EmployeeExit::with(['employee', 'site', 'department']);
        $this->scopeToSite($exitsQuery, $request);
        $this->applyPeriod($request, $exitsQuery, 'exit_date');

        if ($departmentId = $request->query('department_id')) {
            $entriesQuery->where('department_id', $departmentId);
            $exitsQuery->where('department_id', $departmentId);
        }

        return [
            'entries' => $entriesQuery->orderByDesc('entry_date')->get(),
            'exits' => $exitsQuery->orderByDesc('exit_date')->get(),
        ];
    }

    public function cash(Request $request)
    {
        $isSuperAdmin = $request->user()->isSuperAdmin();

        $query = CashTransaction::with(['site', 'creator']);
        $this->scopeToSite($query, $request);
        $this->applyPeriod($request, $query);

        if (! $isSuperAdmin) {
            // Same rule as everywhere else: a responsable's history is only
            // their own declared purchases, never recharges.
            $query->where('type', 'expense');
        }

        if ($beneficiary = $request->query('beneficiary')) {
            $query->where('beneficiary', 'like', "%{$beneficiary}%");
        }

        $paginated = $query->orderByDesc('date')->paginate($request->integer('per_page', 30));

        if (! $isSuperAdmin) {
            $paginated->getCollection()->each(fn (CashTransaction $t) => $t->makeHidden('running_balance'));
        }

        return $paginated;
    }
}
