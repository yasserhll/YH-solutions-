<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Concerns\ReceivesExcelUpload;
use App\Http\Controllers\Controller;
use App\Models\FuelVehicle;
use App\Services\AuditLogger;
use App\Services\EquipmentImportService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Matériel session: the vehicles (camions, engins, véhicules…) of each
 * site, with a QR code per vehicle (generated in the browser from these
 * fields). Same table as Consommation → Matriculation (fuel_vehicles, code
 * unique company-wide), so a plate typed here is the one the Global shows.
 * Site-scoped: a pompiste / responsable only sees and edits the vehicles
 * of its own site(s); a SuperAdmin sees all of them, including the ones
 * not attached to a site yet (?site=none).
 */
class EquipmentController extends Controller
{
    use InteractsWithSites, ReceivesExcelUpload;

    public function index(Request $request)
    {
        $query = $this->scoped($request)->with('site:id,name');

        if ($search = trim((string) $request->query('search'))) {
            $query->where(fn ($q) => $q->where('fleet_code', 'like', "%{$search}%")
                ->orWhere('code', 'like', "%{$search}%")
                ->orWhere('matricule', 'like', "%{$search}%")
                ->orWhere('chassis_number', 'like', "%{$search}%")
                ->orWhere('type', 'like', "%{$search}%"));
        }
        if (array_key_exists($status = (string) $request->query('status'), FuelVehicle::STATUSES)) {
            $query->where('status', $status);
        }
        if ($type = $request->query('type')) {
            $query->where('type', $type);
        }
        if ($kind = $request->query('kind')) {
            match ($kind) {
                'camion' => $query->where('code', 'regexp', '^D[0-9]+$'),
                'engin' => $query->where('code', 'regexp', '^E[0-9]+$'),
                'autre' => $query->where('code', 'not regexp', '^[DE][0-9]+$'),
                default => null,
            };
        }

        // The workbook's own order; vehicles added by hand come after it.
        $page = $query->orderByRaw('sort_order IS NULL')->orderBy('sort_order')->orderBy('id')
            ->paginate(min($request->integer('per_page', 25), 500));

        $counts = $this->scoped($request)->selectRaw('status, COUNT(*) AS n')->groupBy('status')->pluck('n', 'status');

        return response()->json([
            ...$page->toArray(),
            'counts' => collect(FuelVehicle::STATUSES)->map(fn ($label, $key) => (int) ($counts[$key] ?? 0)),
            'types' => $this->scoped($request)->whereNotNull('type')->distinct()->orderBy('type')->pluck('type'),
            'statuses' => FuelVehicle::STATUSES,
        ]);
    }

    /**
     * Code parc + immatriculation required. A plate (or a D… / E… number)
     * already known WITHOUT a site — the vehicles Matriculation knew before
     * this session — is attached to the user's site rather than refused.
     */
    public function store(Request $request)
    {
        $data = $this->validated($request);
        $data['site_id'] = $this->resolveSiteId($request);
        $pumpCode = FuelVehicle::pumpCodeFor($data['fleet_code'], $data['matricule']);

        $vehicle = $this->byPlate($data['matricule'])
            ?? (preg_match('/^[DE]\d+$/', $pumpCode) ? FuelVehicle::with('site:id,name')->where('code', $pumpCode)->first() : null);
        if ($vehicle && $vehicle->site_id !== null) {
            abort(422, $this->duplicateMessage($vehicle));
        }
        $claimed = (bool) $vehicle;
        $vehicle ??= new FuelVehicle(['code' => $this->freeCode($pumpCode, $data['matricule'])]);
        $vehicle->fill($data)->save();

        AuditLogger::log('materiel.created', "Matériel {$vehicle->fleet_code} ({$vehicle->matricule}) ajouté", $vehicle->site_id, $vehicle);

        return response()->json($vehicle->load('site:id,name'), $claimed ? 200 : 201);
    }

    public function update(Request $request, FuelVehicle $fuelVehicle)
    {
        $this->ensureCanTouch($request, $fuelVehicle);
        $data = $this->validated($request);
        // Moving a vehicle to another site: only to one of the user's own sites.
        if ($request->filled('site_id')) {
            $this->ensureSiteAccess($request, (int) $request->input('site_id'));
            $data['site_id'] = (int) $request->input('site_id');
        }
        $other = $this->byPlate($data['matricule']);
        if ($other && $other->id !== $fuelVehicle->id) {
            abort(422, $this->duplicateMessage($other));
        }
        // A corrected D… / E… number moves the pump code with it (if free).
        $pumpCode = FuelVehicle::pumpCodeFor($data['fleet_code'], $data['matricule']);
        if (preg_match('/^[DE]\d+$/', $pumpCode) && $pumpCode !== $fuelVehicle->code) {
            $taken = FuelVehicle::with('site:id,name')->where('code', $pumpCode)->where('id', '!=', $fuelVehicle->id)->first();
            if ($taken) {
                abort(422, $this->duplicateMessage($taken));
            }
            $data['code'] = $pumpCode;
        }

        $old = $fuelVehicle->only(array_keys($data));
        $fuelVehicle->update($data);
        AuditLogger::log('materiel.updated', "Matériel {$fuelVehicle->fleet_code} ({$fuelVehicle->matricule}) modifié", $fuelVehicle->site_id, $fuelVehicle, $old, $data);

        return response()->json($fuelVehicle->load('site:id,name'));
    }

    public function destroy(Request $request, FuelVehicle $fuelVehicle)
    {
        $this->ensureCanTouch($request, $fuelVehicle);
        $fuelVehicle->delete();
        AuditLogger::log('materiel.deleted', 'Matériel '.($fuelVehicle->fleet_code ?? $fuelVehicle->code)." ({$fuelVehicle->matricule}) supprimé", $fuelVehicle->site_id, $fuelVehicle);

        return response()->noContent();
    }

    public function import(Request $request, EquipmentImportService $importer)
    {
        $file = $this->excelUpload($request);
        $result = $importer->import($file->getRealPath(), $file->getClientOriginalName(), $request->user());
        AuditLogger::log('materiel.imported', "Matériel importé depuis {$file->getClientOriginalName()} ({$result['created']} ajouté(s), {$result['updated']} mis à jour)", $this->singleSiteOf($request), new FuelVehicle());

        return response()->json($result);
    }

    private function scoped(Request $request): Builder
    {
        $query = FuelVehicle::query();
        if ($request->user()->isSuperAdmin() && $request->query('site') === 'none') {
            return $query->whereNull('site_id');
        }

        // Only the park: a vehicle known to Consommation but on no site is not
        // listed (a SuperAdmin finds those with "Sans site").
        return $this->scopeToSite($query, $request)->whereNotNull('site_id');
    }

    private function ensureCanTouch(Request $request, FuelVehicle $vehicle): void
    {
        if ($vehicle->site_id === null) {
            abort_unless($request->user()->isSuperAdmin(), 403, "Ce matériel n'est rattaché à aucun site : seul le SuperAdmin peut le modifier.");

            return;
        }
        $this->ensureSiteAccess($request, $vehicle->site_id);
    }

    private function singleSiteOf(Request $request): ?int
    {
        $ids = $request->user()->assignedSiteIds();

        return ! $request->user()->isSuperAdmin() && count($ids) === 1 ? $ids[0] : null;
    }

    /** Only what the workbook has: code parc, immatriculation, châssis, type, (site), statut, remarque. */
    private function validated(Request $request): array
    {
        $clean = fn ($v) => $v === null ? null : (trim(preg_replace('/\s+/u', ' ', (string) $v)) ?: null);
        $compact = fn ($v) => $v === null || trim((string) $v) === '' ? null : strtoupper(preg_replace('/\s+/u', '', (string) $v));
        $request->merge([
            'fleet_code' => $clean($request->input('fleet_code')),
            'matricule' => $compact($request->input('matricule')),
            'chassis_number' => $compact($request->input('chassis_number')),
            'type' => $clean($request->input('type')),
            'notes' => $clean($request->input('notes')),
        ]);

        return $request->validate([
            'fleet_code' => ['required', 'string', 'max:120'],
            'matricule' => ['required', 'string', 'max:120'],
            'chassis_number' => ['nullable', 'string', 'max:80'],
            'type' => ['nullable', 'string', 'max:60'],
            'status' => ['sometimes', Rule::in(array_keys(FuelVehicle::STATUSES))],
            'notes' => ['nullable', 'string', 'max:255'],
        ], [
            'fleet_code.required' => 'Le code parc est obligatoire.',
            'matricule.required' => "L'immatriculation est obligatoire.",
        ]);
    }

    /** "83639A55" and "83639-A-55" are the same plate. */
    private function byPlate(string $plate): ?FuelVehicle
    {
        return FuelVehicle::with('site:id,name')
            ->whereRaw("REPLACE(REPLACE(matricule, '-', ''), ' ', '') = ?", [str_replace('-', '', $plate)])
            ->first();
    }

    private function duplicateMessage(FuelVehicle $vehicle): string
    {
        return 'Ce véhicule existe déjà : code parc '.($vehicle->fleet_code ?? $vehicle->code).', immatriculation '.$vehicle->matricule
            .($vehicle->site ? ', site '.$vehicle->site->name.'.' : '.');
    }

    /** The pump code is unique: one already taken by another vehicle falls back to the plate. */
    private function freeCode(string $code, string $plate): string
    {
        if (! FuelVehicle::where('code', $code)->exists()) {
            return $code;
        }

        return FuelVehicle::where('code', $plate)->exists() ? $plate.'-'.strtolower(Str::random(4)) : $plate;
    }
}
