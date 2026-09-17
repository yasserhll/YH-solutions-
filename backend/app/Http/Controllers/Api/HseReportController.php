<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\HseReport;
use App\Services\ExcelExportService;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * The daily "RAPPORT JOURNALIER HSE" (réf. RJ-HSE-TRP-02): filed by an `hse`
 * user for their site, reviewed/controlled by `responsable_hse` and the
 * SuperAdmin. Site-scoped exactly like every other module (InteractsWithSites),
 * plus one extra visibility rule on top: an `hse` account only ever sees ITS
 * OWN reports (they file the report, they don't audit their peers' — that's
 * the `responsable_hse`'s job), while `responsable_hse`/SuperAdmin see every
 * report across the sites they can access. Route access itself (only `hse`,
 * `responsable_hse`, and SuperAdmin ever reach this controller at all) is
 * enforced by the `hse.access` middleware in routes/api.php, not here.
 */
class HseReportController extends Controller
{
    use InteractsWithSites;

    public function __construct(protected ExcelExportService $excel) {}

    public function index(Request $request)
    {
        $user = $request->user();

        $query = HseReport::with(['site', 'creator']);
        $this->scopeToSite($query, $request);

        if ($user->isHse()) {
            $query->where('created_by', $user->id);
        }

        if ($from = $request->query('date_from')) {
            $query->whereDate('report_date', '>=', $from);
        }
        if ($to = $request->query('date_to')) {
            $query->whereDate('report_date', '<=', $to);
        }

        return $query->orderByDesc('report_date')->orderByDesc('id')->paginate($request->integer('per_page', 15));
    }

    /**
     * A simplified, chart-first view for `hse`/`responsable_hse` — the HSE
     * module has no access to the main Dashboard (see BlockHseModuleRoles),
     * so this is their equivalent: KPI totals, a Conforme/Non conforme
     * split, a daily trend, and (only meaningful for a multi-site
     * responsable_hse/SuperAdmin) a per-site comparison. Same visibility
     * rule as everywhere else: an `hse` account's numbers are its own
     * reports only.
     */
    public function dashboard(Request $request)
    {
        $user = $request->user();

        $base = HseReport::query()->with('site');
        $this->scopeToSite($base, $request);
        if ($user->isHse()) {
            $base->where('created_by', $user->id);
        }

        $to = $request->query('date_to') ?: now()->toDateString();
        $from = $request->query('date_from') ?: now()->subDays(29)->toDateString();
        $reports = (clone $base)->whereBetween('report_date', [$from, $to])->get();

        $totals = [
            'reports_count' => $reports->count(),
            'incidents_count' => (int) $reports->sum('incidents_count'),
            'accidents_count' => (int) $reports->sum('accidents_count'),
            'environmental_impact_count' => (int) $reports->sum('environmental_impact_count'),
            'sanctions_count' => (int) $reports->sum('sanctions_count'),
            'dangerous_situations_count' => (int) $reports->sum('dangerous_situations_count'),
            'non_conformities_count' => (int) $reports->sum('non_conformities_count'),
            'inductions_count' => (int) $reports->sum('inductions_count'),
            'audits_count' => (int) $reports->sum('audits_count'),
            'evacuation_drills_count' => (int) $reports->sum('evacuation_drills_count'),
            'avg_sensitization_participation_rate' => $this->avgOrNull($reports, 'sensitization_participation_rate'),
            'avg_corrective_actions_closure_rate' => $this->avgOrNull($reports, 'corrective_actions_closure_rate'),
        ];

        $generalStateBreakdown = [
            'conforme' => $reports->where('general_state', 'conforme')->count(),
            'non_conforme' => $reports->where('general_state', 'non_conforme')->count(),
        ];

        $trend = $reports
            ->groupBy(fn (HseReport $r) => $r->report_date->toDateString())
            ->map(fn ($group, $date) => [
                'date' => $date,
                'reports_count' => $group->count(),
                'incidents_count' => (int) $group->sum('incidents_count'),
                'accidents_count' => (int) $group->sum('accidents_count'),
                'dangerous_situations_count' => (int) $group->sum('dangerous_situations_count'),
            ])
            ->sortBy('date')
            ->values();

        // Only meaningful when more than one site is in scope — a
        // single-site `hse`/responsable never has anything to compare.
        $bySite = $reports
            ->groupBy('site_id')
            ->map(fn ($group) => [
                'site_id' => $group->first()->site_id,
                'site_name' => $group->first()->site?->name,
                'reports_count' => $group->count(),
                'incidents_count' => (int) $group->sum('incidents_count'),
                'accidents_count' => (int) $group->sum('accidents_count'),
                'dangerous_situations_count' => (int) $group->sum('dangerous_situations_count'),
                'non_conformities_count' => (int) $group->sum('non_conformities_count'),
            ])
            ->sortByDesc('reports_count')
            ->values();

        $recentReports = (clone $base)->with('creator')
            ->orderByDesc('report_date')->orderByDesc('id')
            ->limit(5)->get();

        return response()->json([
            'date_from' => $from,
            'date_to' => $to,
            'totals' => $totals,
            'general_state_breakdown' => $generalStateBreakdown,
            'trend' => $trend,
            'by_site' => $bySite,
            'recent_reports' => $recentReports,
        ]);
    }

    private function avgOrNull($reports, string $column): ?float
    {
        $values = $reports->pluck($column)->filter(fn ($v) => $v !== null);

        return $values->isEmpty() ? null : round((float) $values->avg(), 1);
    }

    protected function rules(): array
    {
        return [
            'report_date' => ['required', 'date'],
            'activities' => ['required', 'string'],
            'spa_count' => ['required', 'integer', 'min:0'],
            'topics_covered' => ['nullable', 'string'],
            'participants_count' => ['required', 'integer', 'min:0'],
            'sanctions_count' => ['required', 'integer', 'min:0'],
            'dangerous_situations_count' => ['required', 'integer', 'min:0'],
            'equipment_inspected' => ['nullable', 'string'],
            'general_state' => ['required', Rule::in(['conforme', 'non_conforme'])],
            'sor_notes' => ['nullable', 'string'],
            'corrective_actions' => ['nullable', 'string'],
            'incidents_count' => ['required', 'integer', 'min:0'],
            'incidents_comment' => ['nullable', 'string', 'max:255'],
            'accidents_count' => ['required', 'integer', 'min:0'],
            'accidents_comment' => ['nullable', 'string', 'max:255'],
            'environmental_impact_count' => ['required', 'integer', 'min:0'],
            'environmental_impact_comment' => ['nullable', 'string', 'max:255'],
            'shift_headcount' => ['nullable', 'integer', 'min:0'],
            'hours_worked' => ['nullable', 'numeric', 'min:0'],
            'sensitization_participation_rate' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'corrective_actions_closure_rate' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'non_conformities_count' => ['required', 'integer', 'min:0'],
            'inductions_count' => ['required', 'integer', 'min:0'],
            'audits_count' => ['required', 'integer', 'min:0'],
            'evacuation_drills_count' => ['required', 'integer', 'min:0'],
        ];
    }

    public function store(Request $request)
    {
        $user = $request->user();

        if (! $user->isHse() && ! $user->isSuperAdmin()) {
            throw new HttpException(403, 'Seul un animateur HSE peut saisir ce rapport.');
        }

        $data = $request->validate($this->rules());
        $data['site_id'] = $this->resolveSiteId($request);
        $data['created_by'] = $user->id;

        $report = HseReport::create($data);

        return response()->json($report->load(['site', 'creator']), 201);
    }

    /**
     * An `hse` account may only correct its own report (same "fix your own
     * mistakes" pattern as everywhere else in the app); `responsable_hse`
     * and SuperAdmin — the controllers of this data — may correct any report
     * within their site scope.
     */
    public function update(Request $request, HseReport $hseReport)
    {
        $this->ensureSiteAccess($request, $hseReport->site_id);
        $this->ensureCanAccessReport($request, $hseReport);

        $data = $request->validate($this->rules());
        $hseReport->update($data);

        return $hseReport->load(['site', 'creator']);
    }

    public function destroy(Request $request, HseReport $hseReport)
    {
        $this->ensureSiteAccess($request, $hseReport->site_id);
        $this->ensureCanAccessReport($request, $hseReport);

        $hseReport->delete();

        return response()->json(['message' => 'Rapport HSE supprimé.']);
    }

    /**
     * A printable/shareable version of the exact paper form (réf.
     * RJ-HSE-TRP-02) — either format reproduces the same layout, colours and
     * fields as the reference document field for field, so the exported file
     * IS the form, not a generic data dump. Same visibility rule as
     * everything else here: an `hse` account only exports its own report.
     */
    public function exportPdf(Request $request, HseReport $hseReport)
    {
        $this->ensureSiteAccess($request, $hseReport->site_id);
        $this->ensureCanAccessReport($request, $hseReport);

        $hseReport->load(['site', 'creator']);

        $pdf = Pdf::loadView('pdf.hse-report', [
            'report' => $hseReport,
            'logoPath' => public_path('logo-transwin.jpg'),
        ])->setPaper('a4', 'portrait');

        return $pdf->download($this->exportFilename($hseReport, 'pdf'));
    }

    public function exportExcel(Request $request, HseReport $hseReport): StreamedResponse
    {
        $this->ensureSiteAccess($request, $hseReport->site_id);
        $this->ensureCanAccessReport($request, $hseReport);

        $hseReport->load(['site', 'creator']);

        return $this->excel->streamHseReportForm($hseReport, $this->exportFilename($hseReport, 'xlsx'));
    }

    protected function exportFilename(HseReport $hseReport, string $extension): string
    {
        return 'rapport-hse-'.Str::slug($hseReport->site->name).'-'.$hseReport->report_date->format('Y-m-d').'.'.$extension;
    }

    /**
     * Same rule for view (export), update, and destroy: an `hse` account may
     * only act on its own report (same "fix your own mistakes" pattern as
     * everywhere else in the app); `responsable_hse` and SuperAdmin — the
     * controllers of this data — may act on any report within their site scope.
     */
    protected function ensureCanAccessReport(Request $request, HseReport $hseReport): void
    {
        $user = $request->user();

        if ($user->isHse() && $hseReport->created_by !== $user->id) {
            throw new HttpException(403, "Vous ne pouvez accéder qu'à vos propres rapports.");
        }
    }
}
