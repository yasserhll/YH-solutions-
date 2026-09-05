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
use App\Models\Site;
use App\Models\Suspension;
use App\Services\ExcelExportService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
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
     * what the on-screen table is scoped to: a responsable's own site name,
     * a superadmin's currently-selected site (via ?site_id=), or "tous-sites"
     * when a superadmin has no site filter applied. Never trust a query
     * site_id blindly here either — it only ever narrows what scopeToSite()
     * already allowed the user to see.
     */
    protected function exportSiteLabel(Request $request): string
    {
        $user = $request->user();

        if (! $user->isSuperAdmin()) {
            return $user->site ? Str::slug($user->site->name) : 'site';
        }

        if ($siteId = $request->query('site_id')) {
            $site = Site::find($siteId);

            return $site ? Str::slug($site->name) : 'site';
        }

        return 'tous-sites';
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

        return $query->orderByDesc('date');
    }

    public function attendance(Request $request)
    {
        return $this->attendanceQuery($request)->paginate($request->integer('per_page', 30));
    }

    public function exportAttendance(Request $request): StreamedResponse
    {
        $rows = $this->attendanceQuery($request)->get()->map(fn (Attendance $a) => [
            $a->date->format('d/m/Y'),
            $a->employee?->full_name,
            $a->site?->name,
            $a->status,
            $a->absence_cause,
            $a->description,
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
