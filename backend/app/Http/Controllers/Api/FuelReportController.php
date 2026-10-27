<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Concerns\ReceivesExcelUpload;
use App\Http\Controllers\Concerns\ResolvesSingleSite;
use App\Http\Controllers\Controller;
use App\Models\FuelAssignment;
use App\Models\FuelReportLine;
use App\Models\Site;
use App\Services\AuditLogger;
use App\Services\ExcelExportService;
use App\Services\FuelImportService;
use App\Services\FuelReportService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Consommation > Rapport: the daily "CONSOMMATION JOURNALIERE DE GASOIL"
 * (camions + engins only), computed by FuelReportService from the imported
 * citernes, plus the site's affectation (drivers per vehicle) it relies on.
 * Always one site at a time (ResolvesSingleSite), like the Global.
 */
class FuelReportController extends Controller
{
    use InteractsWithSites, ReceivesExcelUpload, ResolvesSingleSite;

    public function __construct(protected FuelReportService $reports) {}

    public function show(Request $request)
    {
        $request->validate(['date' => ['nullable', 'date_format:Y-m-d']]);
        $siteId = $this->singleSiteId($request);
        $assignedOnly = $this->assignedOnly($request);
        $lastDate = $this->reports->latestDate($siteId, $assignedOnly);
        $date = $request->query('date') ?: ($lastDate ?? now()->toDateString());

        return response()->json([
            'site' => Site::find($siteId, ['id', 'name']),
            // Last day the imported citerne files go up to — anything after is
            // simply not imported yet (shown as a hint, never a limit).
            'last_date' => $lastDate,
            'assignments_count' => FuelAssignment::where('site_id', $siteId)->count(),
            'assigned_only' => $assignedOnly,
            ...$this->reports->build($siteId, $date, $assignedOnly),
        ]);
    }

    /** Drivers / activité typed for one vehicle on one day of the report. */
    public function saveLine(Request $request)
    {
        $data = $request->validate([
            'date' => ['required', 'date_format:Y-m-d'],
            'vehicle_code' => ['required', 'string', 'max:60'],
            'driver_1' => ['nullable', 'string', 'max:120'],
            'driver_2' => ['nullable', 'string', 'max:120'],
            'activity' => ['nullable', 'string', 'max:120'],
        ]);
        $siteId = $this->singleSiteId($request);
        $clean = fn ($v) => ($v = trim(preg_replace('/\s+/', ' ', (string) $v))) === '' ? null : mb_strtoupper($v);

        $line = FuelReportLine::updateOrCreate(
            ['site_id' => $siteId, 'date' => $data['date'], 'vehicle_code' => $data['vehicle_code']],
            ['driver_1' => $clean($data['driver_1'] ?? null), 'driver_2' => $clean($data['driver_2'] ?? null), 'activity' => $clean($data['activity'] ?? null), 'updated_by' => $request->user()->id]
        );
        AuditLogger::log('fuel.report_updated', "Rapport du ".Carbon::parse($data['date'])->format('d/m/Y')." : {$data['vehicle_code']} mis à jour (chauffeurs / activité)", $siteId, $line);

        return response()->json($line);
    }

    /** One day (?date=) or a whole month (?month=YYYY-MM, one sheet per day — like RAPPORT GSL MM-YYYY.xlsx). */
    public function export(Request $request, ExcelExportService $excel)
    {
        $request->validate([
            'date' => ['required_without:month', 'nullable', 'date_format:Y-m-d'],
            'month' => ['required_without:date', 'nullable', 'date_format:Y-m'],
        ]);
        $siteId = $this->singleSiteId($request);
        $site = Site::findOrFail($siteId);

        $assignedOnly = $this->assignedOnly($request);
        $dates = $request->filled('month') ? $this->reports->datesInMonth($siteId, $request->query('month'), $assignedOnly) : [$request->query('date')];
        abort_if(! $dates, 422, 'Aucun plein de camion ou d\'engin sur ce mois.');

        $reports = array_map(fn ($date) => $this->reports->build($siteId, $date, $assignedOnly), $dates);
        $suffix = $request->filled('month') ? Carbon::parse($request->query('month').'-01')->format('m-Y') : Carbon::parse($dates[0])->format('d-m-Y');

        return $excel->streamFuelDailyReports('rapport-gsl-'.str($site->name)->slug().'-'.$suffix.'.xlsx', $site->name, $reports);
    }

    /** A site responsable's report only lists the vehicles of the site's affectation; a SuperAdmin sees every camion/engin. */
    protected function assignedOnly(Request $request): bool
    {
        return ! $request->user()->isSuperAdmin();
    }

    // ------------------------------------------------------------ affectation

    public function assignments(Request $request)
    {
        $siteId = $this->singleSiteId($request);

        return response()->json(
            FuelAssignment::where('site_id', $siteId)->orderBy('category')->orderBy('sort_order')->orderBy('code')->get()
        );
    }

    public function storeAssignment(Request $request)
    {
        $siteId = $this->singleSiteId($request);
        $assignment = FuelAssignment::create($this->validatedAssignment($request, $siteId) + [
            'site_id' => $siteId,
            'sort_order' => (int) FuelAssignment::where('site_id', $siteId)->max('sort_order') + 1,
        ]);
        AuditLogger::log('fuel.assignment_created', "Affectation {$assignment->label} ajoutée", $siteId, $assignment);

        return response()->json($assignment, 201);
    }

    public function updateAssignment(Request $request, FuelAssignment $fuelAssignment)
    {
        $this->ensureSiteAccess($request, $fuelAssignment->site_id);
        $fuelAssignment->update($this->validatedAssignment($request, $fuelAssignment->site_id, $fuelAssignment));
        AuditLogger::log('fuel.assignment_updated', "Affectation {$fuelAssignment->label} modifiée", $fuelAssignment->site_id, $fuelAssignment);

        return response()->json($fuelAssignment);
    }

    public function destroyAssignment(Request $request, FuelAssignment $fuelAssignment)
    {
        $this->ensureSiteAccess($request, $fuelAssignment->site_id);
        $fuelAssignment->delete();
        AuditLogger::log('fuel.assignment_deleted', "Affectation {$fuelAssignment->label} supprimée", $fuelAssignment->site_id, $fuelAssignment);

        return response()->noContent();
    }

    public function importAssignments(Request $request, FuelImportService $importer)
    {
        $file = $this->excelUpload($request);
        $siteId = $this->singleSiteId($request);

        $result = $importer->importAssignments($file->getRealPath(), $file->getClientOriginalName(), $siteId);
        AuditLogger::log('fuel.assignments_imported', "Affectation importée depuis {$file->getClientOriginalName()} ({$result['created']} ajoutées, {$result['updated']} mises à jour)", $siteId, new FuelAssignment());

        return response()->json($result);
    }

    protected function validatedAssignment(Request $request, int $siteId, ?FuelAssignment $assignment = null): array
    {
        $request->merge(['code' => FuelAssignment::codeFromLabel($request->input('label'))]);
        $data = $request->validate([
            'label' => ['required', 'string', 'max:80'],
            'code' => ['required', Rule::unique('fuel_assignments', 'code')->where('site_id', $siteId)->ignore($assignment?->id)],
            'category' => ['required', Rule::in(['camion', 'engin'])],
            'driver_1' => ['nullable', 'string', 'max:120'],
            'driver_2' => ['nullable', 'string', 'max:120'],
            'replacements' => ['nullable', 'string', 'max:255'],
            'activity' => ['nullable', 'string', 'max:120'],
        ], [
            'code.required' => 'Le code doit contenir un numéro de camion (D…) ou d\'engin (E…), ex. D140, 480-E49.',
            'code.unique' => 'Ce véhicule a déjà une affectation sur ce site.',
        ]);

        foreach (['label', 'driver_1', 'driver_2', 'replacements', 'activity'] as $field) {
            $value = trim(preg_replace('/\s+/', ' ', (string) ($data[$field] ?? '')));
            $data[$field] = $value === '' ? null : ($field === 'label' ? $value : mb_strtoupper($value));
        }

        return $data;
    }
}
