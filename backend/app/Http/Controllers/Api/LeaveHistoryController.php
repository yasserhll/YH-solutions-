<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Concerns\ReceivesExcelUpload;
use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Leave;
use App\Models\LeaveHistory;
use App\Services\AuditLogger;
use App\Services\LeaveHistoryImportService;
use Carbon\Carbon;
use Illuminate\Http\Request;

/**
 * Congés → "Historique & soldes": per employee, the days taken month by
 * month (the old "ETAT DE CONGE" workbooks + the congés declared in the
 * app), the right acquired (whole months since embauche × 1.5, exactly the
 * workbooks' formula) and what remains. Scoped by the employee's CURRENT
 * site, like the fiche employé.
 */
class LeaveHistoryController extends Controller
{
    use InteractsWithSites, ReceivesExcelUpload;

    public function __construct(private LeaveHistoryImportService $importer) {}

    public function index(Request $request)
    {
        $query = Employee::with(['site:id,name', 'position:id,name']);
        $this->scopeToSite($query, $request);

        if ($search = trim((string) $request->query('search'))) {
            $query->where(fn ($q) => $q->where('full_name', 'like', "%{$search}%")->orWhere('matricule', 'like', "%{$search}%"));
        }
        if (in_array($status = $request->query('status'), ['actif', 'sorti'], true)) {
            $query->where('status', $status);
        }
        if ($request->query('source') === 'historique') {
            $query->whereHas('leaveHistory');
        }

        $page = $query->orderBy('full_name')->paginate($request->integer('per_page', 25));
        $ids = $page->getCollection()->pluck('id');

        $history = LeaveHistory::whereIn('employee_id', $ids)->orderBy('year')->orderBy('month')->get()->groupBy('employee_id');
        $leaves = Leave::whereIn('employee_id', $ids)->get(['id', 'employee_id', 'start_date', 'duration_days'])->groupBy('employee_id');

        $page->getCollection()->transform(fn (Employee $e) => $this->balance($e, $history[$e->id] ?? collect(), $leaves[$e->id] ?? collect()));

        return $page;
    }

    public function import(Request $request)
    {
        $file = $this->excelUpload($request);
        $data = $request->validate([
            'site_id' => ['nullable', 'integer', 'exists:sites,id'],
            'new_status' => ['nullable', 'in:actif,sorti'],
        ]);

        [$lines, $sheets] = $this->importer->parse($file->getRealPath());

        $user = $this->currentUser($request);
        if (! empty($data['site_id'])) {
            $siteId = (int) $data['site_id'];
        } elseif (! $user->isSuperAdmin() && count($user->assignedSiteIds()) === 1) {
            $siteId = $user->assignedSiteIds()[0];
        } else {
            $site = LeaveHistoryImportService::guessSite($file->getClientOriginalName(), ...$sheets);
            abort_unless($site, 422, 'Choisissez le site de ce fichier (impossible de le reconnaître dans son nom).');
            $siteId = $site->id;
        }
        $this->ensureSiteAccess($request, $siteId);

        $accessible = $user->isSuperAdmin() ? \App\Models\Site::pluck('id')->all() : $user->assignedSiteIds();
        $result = $this->importer->import($lines, $siteId, $accessible, $data['new_status'] ?? 'sorti', $user->id);
        $result['site'] = \App\Models\Site::whereKey($siteId)->value('name');

        AuditLogger::log(
            'leave.history_imported',
            "Historique des congés importé ({$result['site']}) — {$result['lines']} personne(s), {$result['created']} ajoutée(s), {$result['days']} j",
            $siteId,
            \App\Models\Site::find($siteId)
        );

        return $result;
    }

    private function balance(Employee $employee, $history, $leaves): array
    {
        $months = [];
        foreach ($history as $row) {
            $months[sprintf('%04d-%02d', $row->year, $row->month)] = ['days' => $row->days, 'source' => 'historique'];
        }
        // A congé declared in the app counts in its start month — unless the
        // workbook already gives that month (the same congé, written in both).
        $appDays = 0;
        foreach ($leaves as $leave) {
            $key = $leave->start_date->format('Y-m');
            if (($months[$key]['source'] ?? null) === 'historique') {
                continue;
            }
            $months[$key] = ['days' => ($months[$key]['days'] ?? 0) + $leave->duration_days, 'source' => 'app'];
            $appDays += $leave->duration_days;
        }
        ksort($months);

        $entry = $employee->entry_date ? Carbon::parse($employee->entry_date) : null;
        $monthsSince = LeaveHistoryImportService::monthsSince($entry);
        $right = $monthsSince * LeaveHistory::DAYS_PER_MONTH;
        $historyDays = round((float) $history->sum('days'), 1);
        $taken = round($historyDays + $appDays, 1);

        return [
            'id' => $employee->id,
            'full_name' => $employee->full_name,
            'matricule' => $employee->matricule,
            'status' => $employee->status,
            'entry_date' => $entry?->toDateString(),
            'site' => $employee->site,
            'position' => $employee->position,
            'months_since_entry' => $monthsSince,
            'right_days' => $right,
            'history_days' => $historyDays,
            'app_days' => $appDays,
            'taken_days' => $taken,
            'remaining_days' => round($right - $taken, 1),
            'months' => collect($months)->map(fn ($m, $k) => ['month' => $k] + $m)->values(),
        ];
    }
}
