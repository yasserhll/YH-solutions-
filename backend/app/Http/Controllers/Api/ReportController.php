<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\CashTransaction;
use App\Models\DisciplinaryWarning;
use App\Models\Employee;
use App\Models\Entry;
use App\Models\EmployeeExit;
use App\Models\LeaveRequest;
use App\Models\Site;
use App\Models\Suspension;
use App\Services\AttendanceAutomation;
use App\Services\ExcelExportService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReportController extends Controller
{
    use InteractsWithSites;

    public function __construct(protected ExcelExportService $excel)
    {
    }

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

    /**
     * Every export filename carries which site it covers, mirroring exactly
     * what the on-screen table is scoped to: whichever site is selected via
     * ?site_id= (validated against the user's own assigned sites — a
     * responsable can never force another site's name into their filename),
     * a single-site responsable's own site name when no filter is applied,
     * "tous-sites" for a superadmin with no filter, or "mes-sites" for a
     * multi-site responsable viewing all of their sites at once.
     */
    protected function exportSiteLabel(Request $request): string
    {
        $user = $request->user();

        if ($siteId = $request->query('site_id')) {
            $this->ensureSiteAccess($request, (int) $siteId);
            $site = Site::find($siteId);

            return $site ? Str::slug($site->name) : 'site';
        }

        if ($user->isSuperAdmin()) {
            return 'tous-sites';
        }

        return $user->site ? Str::slug($user->site->name) : 'mes-sites';
    }

    protected function attendanceQuery(Request $request): Builder
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
        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
        }

        return $query->orderByDesc('date');
    }

    /**
     * Merges real Attendance rows with the auto-derived Maladie/Congé/Mise à
     * pied days that never get a real row (see AttendanceAutomation) —
     * without this, a report/export would silently be missing every day
     * covered only by an active period. Real rows always win over a virtual
     * one for the same employee/date. Returns plain associative rows so both
     * shapes (Eloquent model vs. synthetic array) are handled uniformly by
     * the caller.
     */
    protected function attendanceRows(Request $request): Collection
    {
        $real = $this->attendanceQuery($request)->get();
        $existingKeys = $real->map(fn (Attendance $a) => $a->employee_id.'|'.$a->date->toDateString())->all();

        $employeesQuery = Employee::query()->with('site');
        $this->scopeToSite($employeesQuery, $request);
        if ($employeeId = $request->query('employee_id')) {
            $employeesQuery->where('id', $employeeId);
        }
        $employeesById = $employeesQuery->get()->keyBy('id');

        $virtual = collect(AttendanceAutomation::virtualRows(
            $employeesById,
            $request->query('date_from'),
            $request->query('date_to'),
            $existingKeys,
        ));

        if ($status = $request->query('status')) {
            $virtual = $virtual->where('status', $status);
        }
        if ($cause = $request->query('absence_cause')) {
            $virtual = $virtual->where('absence_cause', $cause);
        }
        if ($search = $request->query('search')) {
            $virtual = $virtual->filter(fn ($r) => str_contains(mb_strtolower($r['employee_name'] ?? ''), mb_strtolower($search)));
        }

        // Shaped exactly like a real Attendance row (nested employee/site,
        // `id: null`) so the frontend's Rapports table can render both kinds
        // through the same columns — `auto: true` is the only tell.
        $realRows = $real->map(fn (Attendance $a) => [
            'id' => $a->id,
            'date' => $a->date->toDateString(),
            'employee' => ['id' => $a->employee_id, 'full_name' => $a->employee?->full_name],
            'site' => ['id' => $a->site_id, 'name' => $a->site?->name],
            'status' => $a->status,
            'absence_cause' => $a->absence_cause,
            'description' => $a->description,
            'auto' => false,
        ]);

        $virtualRows = $virtual->map(fn (array $r) => [
            'id' => null,
            'date' => $r['date'],
            'employee' => ['id' => $r['employee_id'], 'full_name' => $r['employee_name']],
            'site' => ['id' => $r['site_id'], 'name' => $r['site_name']],
            'status' => $r['status'],
            'absence_cause' => $r['absence_cause'],
            'description' => $r['description'],
            'auto' => true,
        ]);

        return $realRows->concat($virtualRows)->sortByDesc('date')->values();
    }

    public function attendance(Request $request)
    {
        $rows = $this->attendanceRows($request);
        $page = $request->integer('page', 1);
        $perPage = $request->integer('per_page', 30);

        return new LengthAwarePaginator(
            $rows->forPage($page, $perPage)->values(),
            $rows->count(),
            $perPage,
            $page,
            ['path' => $request->url(), 'query' => $request->query()],
        );
    }

    public function exportAttendance(Request $request): StreamedResponse
    {
        $rows = $this->attendanceRows($request)->map(fn (array $r) => [
            (new \DateTime($r['date']))->format('d/m/Y'),
            $r['employee']['full_name'],
            $r['site']['name'],
            $r['status'],
            $r['absence_cause'],
            $r['description'],
        ]);

        return $this->excel->stream(
            "pointage-{$this->exportSiteLabel($request)}.xlsx",
            ['Date', 'Employé', 'Site', 'Statut', 'Cause', 'Description'],
            $rows,
        );
    }

    protected function leavesQuery(Request $request): Builder
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
        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
        }

        return $query->orderByDesc('request_date');
    }

    public function leaves(Request $request)
    {
        return $this->leavesQuery($request)->paginate($request->integer('per_page', 30));
    }

    public function exportLeaves(Request $request): StreamedResponse
    {
        $rows = $this->leavesQuery($request)->get()->map(fn (LeaveRequest $r) => [
            $r->request_date->format('d/m/Y'),
            $r->employee?->full_name,
            $r->site?->name,
            $r->duration_days,
            $r->status,
            $r->reason,
        ]);

        return $this->excel->stream(
            "conges-{$this->exportSiteLabel($request)}.xlsx",
            ['Demandé le', 'Employé', 'Site', 'Durée (j)', 'Statut', 'Motif'],
            $rows,
        );
    }

    protected function warningsQuery(Request $request): Builder
    {
        $query = DisciplinaryWarning::with(['employee', 'site'])->selectRaw("'avertissement' as type, id, employee_id, site_id, date, reason, description");
        $this->scopeToSite($query, $request);
        $this->applyPeriod($request, $query);

        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }

        return $query;
    }

    protected function suspensionsQuery(Request $request): Builder
    {
        $query = Suspension::with(['employee', 'site'])->selectRaw("'mise_a_pied' as type, id, employee_id, site_id, date, reason, description");
        $this->scopeToSite($query, $request);
        $this->applyPeriod($request, $query);

        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }

        return $query;
    }

    public function sanctions(Request $request)
    {
        $type = $request->query('type');

        $warnings = $type === 'mise_a_pied' ? collect() : $this->warningsQuery($request)->get();
        $suspensions = $type === 'avertissement' ? collect() : $this->suspensionsQuery($request)->get();

        return $warnings->concat($suspensions)->sortByDesc('date')->values();
    }

    public function exportSanctions(Request $request): StreamedResponse
    {
        $type = $request->query('type');

        $warnings = $type === 'mise_a_pied' ? collect() : $this->warningsQuery($request)->get();
        $suspensions = $type === 'avertissement' ? collect() : $this->suspensionsQuery($request)->get();

        $rows = $warnings->concat($suspensions)->sortByDesc('date')->values()->map(fn ($s) => [
            $s->date->format('d/m/Y'),
            $s->employee?->full_name,
            $s->site?->name,
            $s->type === 'mise_a_pied' ? 'Mise à pied' : 'Avertissement',
            $s->reason,
            $s->description,
        ]);

        return $this->excel->stream(
            "sanctions-{$this->exportSiteLabel($request)}.xlsx",
            ['Date', 'Employé', 'Site', 'Type', 'Motif', 'Description'],
            $rows,
        );
    }

    protected function entriesQuery(Request $request): Builder
    {
        $query = Entry::with(['employee', 'site', 'department', 'position']);
        $this->scopeToSite($query, $request);
        $this->applyPeriod($request, $query, 'entry_date');

        if ($departmentId = $request->query('department_id')) {
            $query->where('department_id', $departmentId);
        }

        return $query->orderByDesc('entry_date');
    }

    protected function exitsQuery(Request $request): Builder
    {
        $query = EmployeeExit::with(['employee', 'site', 'department', 'position']);
        $this->scopeToSite($query, $request);
        $this->applyPeriod($request, $query, 'exit_date');

        if ($departmentId = $request->query('department_id')) {
            $query->where('department_id', $departmentId);
        }

        return $query->orderByDesc('exit_date');
    }

    public function movements(Request $request)
    {
        return [
            'entries' => $this->entriesQuery($request)->get(),
            'exits' => $this->exitsQuery($request)->get(),
        ];
    }

    public function exportMovements(Request $request): StreamedResponse
    {
        $entryRows = $this->entriesQuery($request)->get()->map(fn (Entry $e) => [
            'Entrée',
            $e->entry_date->format('d/m/Y'),
            $e->full_name,
            $e->site?->name,
            $e->department?->name,
            $e->position?->name,
        ]);

        $exitRows = $this->exitsQuery($request)->get()->map(fn (EmployeeExit $e) => [
            'Sortie',
            $e->exit_date->format('d/m/Y'),
            $e->full_name,
            $e->site?->name,
            $e->department?->name,
            $e->position?->name,
        ]);

        return $this->excel->stream(
            "entrees-sorties-{$this->exportSiteLabel($request)}.xlsx",
            ['Mouvement', 'Date', 'Nom complet', 'Site', 'Département', 'Fonction'],
            $entryRows->concat($exitRows),
        );
    }

    protected function cashQuery(Request $request): Builder
    {
        $isSuperAdmin = $request->user()->isSuperAdmin();

        $query = CashTransaction::with(['site', 'creator']);
        $this->scopeToSite($query, $request);
        $this->applyPeriod($request, $query);

        if (! $isSuperAdmin) {
            // Same rule as everywhere else: a responsable's history is only
            // their own declared purchases and transfers received, never
            // master-caisse recharges.
            $query->whereIn('type', ['expense', 'transfer']);
        }

        if ($beneficiary = $request->query('beneficiary')) {
            $query->where('beneficiary', 'like', "%{$beneficiary}%");
        }

        return $query->orderByDesc('date');
    }

    public function cash(Request $request)
    {
        $isSuperAdmin = $request->user()->isSuperAdmin();
        $paginated = $this->cashQuery($request)->paginate($request->integer('per_page', 30));

        if (! $isSuperAdmin) {
            $paginated->getCollection()->each(fn (CashTransaction $t) => $t->makeHidden('running_balance'));
        }

        return $paginated;
    }

    public function exportCash(Request $request): StreamedResponse
    {
        $isSuperAdmin = $request->user()->isSuperAdmin();

        $rows = $this->cashQuery($request)->get()->map(function (CashTransaction $t) use ($isSuperAdmin) {
            $row = [
                $t->date->format('d/m/Y'),
                match ($t->type) {
                    'expense' => 'Dépense',
                    'entry' => 'Entrée',
                    'transfer' => 'Transfert',
                },
                $t->beneficiary,
                $t->site?->name ?? '—',
                $t->description,
                (float) $t->amount,
            ];

            if ($isSuperAdmin) {
                // The admin's real global balance — never reduced by a transfer.
                $row[] = (float) $t->running_balance;
            } else {
                // A responsable's own site's remaining spending limit.
                $row[] = $t->site_running_balance !== null ? (float) $t->site_running_balance : null;
            }

            return $row;
        });

        $headers = ['Date', 'Type', 'Bénéficiaire', 'Site', 'Description', 'Montant (DH)'];
        $headers[] = $isSuperAdmin ? 'Reste global (DH)' : 'Solde site (DH)';

        return $this->excel->stream(
            "caisse-{$this->exportSiteLabel($request)}.xlsx",
            $headers,
            $rows,
            fn (array $row) => in_array($row[1], ['Entrée', 'Transfert'], true),
        );
    }
}
