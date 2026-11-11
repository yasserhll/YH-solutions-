<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Concerns\ReceivesExcelUpload;
use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\HseAccident;
use App\Models\Site;
use App\Services\AuditLogger;
use App\Services\ExcelExportService;
use App\Services\HseAccidentImportService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * "Suivi ATIT": accidents et incidents de travail, entered one by one or
 * imported from the company's "BILAN GLOBAL DES ACCIDENTS" workbook, with a
 * bilan (KPIs + charts) and an Excel export that replicates that workbook.
 * Behind the `suivi_atit` session (routes/api.php); site-scoped like every
 * other module. Anyone with the session may declare an event; an `hse`
 * animateur only corrects / deletes the lines it entered itself, a
 * responsable_hse / SuperAdmin any line of its sites (same rule as the
 * daily HSE reports).
 */
class HseAccidentController extends Controller
{
    use InteractsWithSites, ReceivesExcelUpload;

    public function __construct(protected ExcelExportService $excel) {}

    public function index(Request $request)
    {
        return $this->filtered($request)
            ->with(['site', 'creator:id,name', 'employee:id,full_name,entry_date'])
            ->orderByDesc('occurred_on')->orderByDesc('occurred_time')->orderByDesc('id')
            ->paginate(min($request->integer('per_page', 15), 100));
    }

    /** The bilan: totals, per month, per site, per shift, per decision — same filters as the list. */
    public function summary(Request $request)
    {
        $rows = $this->filtered($request)->with('site')->get();
        $accidents = $rows->where('type', 'accident');

        $months = $rows->groupBy(fn (HseAccident $a) => $a->occurred_on->format('Y-m'))
            ->map(fn ($g, $m) => [
                'month' => $m,
                'accidents' => $g->where('type', 'accident')->count(),
                'incidents' => $g->where('type', 'incident')->count(),
            ])->sortKeys()->values();

        $bySite = $rows->groupBy('site_id')->map(fn ($g) => [
            'site_id' => $g->first()->site_id,
            'site_name' => $g->first()->site?->name,
            'accidents' => $g->where('type', 'accident')->count(),
            'incidents' => $g->where('type', 'incident')->count(),
        ])->sortBy('site_name')->values();

        $byShift = collect([1, 2, 3])->map(fn ($s) => ['shift' => $s, 'count' => $rows->where('shift', $s)->count()])
            ->push(['shift' => null, 'count' => $rows->whereNull('shift')->count()])
            ->filter(fn ($s) => $s['count'] > 0)->values();

        $byDecision = collect(HseAccident::DECISIONS)
            ->map(fn ($d) => ['decision' => $d, 'label' => HseAccident::DECISION_LABELS[$d], 'count' => $rows->where('decision', $d)->count()])
            ->push(['decision' => null, 'label' => 'Non décidée', 'count' => $rows->whereNull('decision')->count()])
            ->filter(fn ($d) => $d['count'] > 0)->values();

        // The vehicles / drivers that come back more than once.
        $repeat = fn (string $field) => $rows->filter(fn ($a) => filled($a->{$field}))
            ->groupBy(fn ($a) => mb_strtolower(trim($a->{$field})))
            ->filter(fn ($g) => $g->count() > 1)
            ->map(fn ($g) => ['label' => trim($g->first()->{$field}), 'count' => $g->count()])
            ->sortByDesc('count')->take(5)->values();

        return response()->json([
            'totals' => [
                'total' => $rows->count(),
                'accidents' => $accidents->count(),
                'incidents' => $rows->where('type', 'incident')->count(),
                'licenciements' => $rows->where('decision', 'licenciement')->count(),
                'map_days' => (int) $rows->where('decision', 'map')->sum('decision_days'),
                'map_count' => $rows->where('decision', 'map')->count(),
                'sick_days' => (int) $rows->where('decision', 'repos_maladie')->sum('decision_days'),
                'sick_count' => $rows->where('decision', 'repos_maladie')->count(),
                'last_accident_date' => $accidents->max(fn ($a) => $a->occurred_on->toDateString()),
            ],
            'by_month' => $months,
            'by_site' => $bySite,
            'by_shift' => $byShift,
            'by_decision' => $byDecision,
            'repeat_drivers' => $repeat('driver_name'),
            'repeat_equipment' => $repeat('equipment'),
        ]);
    }

    public function store(Request $request)
    {
        $data = $this->validated($request);
        $data['site_id'] = $this->resolveSiteId($request);
        $data['created_by'] = $request->user()->id;
        $this->checkEmployee($request, $data);

        $accident = HseAccident::create($data);
        AuditLogger::log('atit.created', ucfirst($this->kind($accident))." déclaré — {$accident->driver_name} le {$accident->occurred_on->format('d/m/Y')}", $accident->site_id, $accident, null, $accident->toArray());

        return response()->json($accident->load(['site', 'creator:id,name', 'employee:id,full_name,entry_date']), 201);
    }

    public function update(Request $request, HseAccident $hseAccident)
    {
        $this->ensureCanEdit($request, $hseAccident);
        $data = $this->validated($request);
        if ($request->filled('site_id') && (int) $request->input('site_id') !== $hseAccident->site_id) {
            $this->ensureSiteAccess($request, (int) $request->input('site_id'));
            $data['site_id'] = (int) $request->input('site_id');
        }
        $data['site_id'] ??= $hseAccident->site_id;
        $this->checkEmployee($request, $data);

        $old = $hseAccident->toArray();
        $hseAccident->update($data);
        AuditLogger::log('atit.updated', ucfirst($this->kind($hseAccident))." modifié — {$hseAccident->driver_name} le {$hseAccident->occurred_on->format('d/m/Y')}", $hseAccident->site_id, $hseAccident, $old, $hseAccident->toArray());

        return response()->json($hseAccident->load(['site', 'creator:id,name', 'employee:id,full_name,entry_date']));
    }

    public function destroy(Request $request, HseAccident $hseAccident)
    {
        $this->ensureCanEdit($request, $hseAccident);
        $hseAccident->delete();
        AuditLogger::log('atit.deleted', ucfirst($this->kind($hseAccident))." supprimé — {$hseAccident->driver_name} le {$hseAccident->occurred_on->format('d/m/Y')}", $hseAccident->site_id, $hseAccident);

        return response()->json(['message' => 'Événement supprimé.']);
    }

    /** Replica of the "BILAN GLOBAL DES ACCIDENTS" workbook, for the rows of the current filters. */
    public function export(Request $request)
    {
        $rows = $this->filtered($request)->with('site')
            ->orderBy('occurred_on')->orderBy('occurred_time')->orderBy('id')->get();

        $hasIncidents = $rows->contains('type', 'incident');
        $kind = match (true) {
            $request->query('type') === 'incident' => 'Incidents',
            $hasIncidents && $rows->contains('type', 'accident') => 'Accidents et Incidents',
            $hasIncidents => 'Incidents',
            default => 'Accidents',
        };
        $title = "Bilan Global des {$kind}".$this->periodLabel($request, $rows);

        $siteLabel = 'tous-sites';
        if ($request->filled('site_id')) {
            $siteLabel = Str::slug(Site::find($request->integer('site_id'))?->name ?? 'site');
        } elseif (count($ids = $request->user()->assignedSiteIds()) === 1 && ! $request->user()->isSuperAdmin()) {
            $siteLabel = Str::slug(Site::find($ids[0])?->name ?? 'site');
        }

        return $this->excel->streamAccidentBilan("bilan-atit-{$siteLabel}.xlsx", $title, $rows->all(), $hasIncidents && $kind !== 'Incidents');
    }

    public function import(Request $request, HseAccidentImportService $importer)
    {
        $file = $this->excelUpload($request);
        $result = $importer->import($file->getRealPath(), $file->getClientOriginalName(), $request->user());

        foreach ($result['touched'] as $siteId => $accidents) {
            AuditLogger::log('atit.imported', 'Import « '.$file->getClientOriginalName().' » : '.count($accidents).' événement(s) enregistré(s)', $siteId, $accidents[0]);
        }
        unset($result['touched']);

        return response()->json($result);
    }

    private function filtered(Request $request): Builder
    {
        $query = HseAccident::query();
        $this->scopeToSite($query, $request);

        if (in_array($type = $request->query('type'), HseAccident::TYPES, true)) {
            $query->where('type', $type);
        }
        if ($decision = $request->query('decision')) {
            $decision === 'none' ? $query->whereNull('decision') : $query->where('decision', $decision);
        }
        if ($shift = $request->integer('shift')) {
            $query->where('shift', $shift);
        }
        if ($from = $request->query('date_from')) {
            $query->whereDate('occurred_on', '>=', $from);
        }
        if ($to = $request->query('date_to')) {
            $query->whereDate('occurred_on', '<=', $to);
        }
        if ($search = trim((string) $request->query('search'))) {
            $query->where(fn ($q) => $q->where('driver_name', 'like', "%{$search}%")
                ->orWhere('equipment', 'like', "%{$search}%")
                ->orWhere('zone', 'like', "%{$search}%")
                ->orWhere('description', 'like', "%{$search}%")
                ->orWhere('causes', 'like', "%{$search}%"));
        }

        return $query;
    }

    private function validated(Request $request): array
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(HseAccident::TYPES)],
            'occurred_on' => ['required', 'date', 'before_or_equal:today'],
            'occurred_time' => ['nullable', 'date_format:H:i,H:i:s'],
            'shift' => ['nullable', 'integer', Rule::in([1, 2, 3])],
            'zone' => ['nullable', 'string', 'max:255'],
            'employee_id' => ['nullable', 'integer', 'exists:employees,id'],
            'driver_name' => ['required', 'string', 'max:255'],
            'driver_age' => ['nullable', 'integer', 'min:14', 'max:99'],
            'driver_seniority' => ['nullable', 'string', 'max:60'],
            'equipment' => ['nullable', 'string', 'max:120'],
            'description' => ['required', 'string'],
            'causes' => ['nullable', 'string'],
            'decision' => ['nullable', Rule::in(HseAccident::DECISIONS)],
            'decision_days' => ['nullable', 'integer', 'min:1', 'max:999'],
            'decision_note' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
        ], [
            'occurred_on.before_or_equal' => "La date de l'événement ne peut pas être dans le futur.",
        ]);

        if (! in_array($data['decision'] ?? null, HseAccident::DECISIONS_WITH_DAYS, true)) {
            $data['decision_days'] = null;
        }
        if (($data['decision'] ?? null) !== 'autre') {
            $data['decision_note'] = null;
        }

        return $data;
    }

    /** A linked fiche must belong to one of the user's sites. */
    private function checkEmployee(Request $request, array $data): void
    {
        if (! empty($data['employee_id'])) {
            $employee = Employee::withTrashed()->findOrFail($data['employee_id']);
            $this->ensureSiteAccess($request, $employee->site_id);
        }
    }

    private function ensureCanEdit(Request $request, HseAccident $accident): void
    {
        $this->ensureSiteAccess($request, $accident->site_id);
        $user = $request->user();
        abort_if($user->isHse() && $accident->created_by !== $user->id, 403, 'Vous ne pouvez modifier que les événements que vous avez saisis.');
    }

    private function kind(HseAccident $accident): string
    {
        return $accident->type === 'incident' ? 'incident' : 'accident';
    }

    /** " (Janvier - Septembre 2026)", " (Novembre 2025 - Février 2026)", " (Mars 2026)". */
    private function periodLabel(Request $request, $rows): string
    {
        $from = $request->query('date_from') ?: $rows->min(fn ($a) => $a->occurred_on->toDateString());
        // Ends on the last event, like "(Janvier - Septembre 2026)", even when the filter runs to December.
        $to = $rows->max(fn ($a) => $a->occurred_on->toDateString()) ?: $request->query('date_to');
        if (! $from || ! $to) {
            return '';
        }
        $from = Carbon::parse($from)->locale('fr');
        $to = Carbon::parse($to)->locale('fr');
        $month = fn (Carbon $d) => ucfirst($d->translatedFormat('F'));

        if ($from->format('Y-m') === $to->format('Y-m')) {
            return " ({$month($from)} {$from->year})";
        }
        if ($from->year === $to->year) {
            return " ({$month($from)} - {$month($to)} {$to->year})";
        }

        return " ({$month($from)} {$from->year} - {$month($to)} {$to->year})";
    }
}
