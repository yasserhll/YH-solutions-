<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\ReceivesExcelUpload;
use App\Http\Controllers\Controller;
use App\Models\FuelVehicle;
use App\Services\AuditLogger;
use App\Services\FuelConsumptionService;
use App\Services\FuelImportService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Consommation > Matriculation. Company-wide reference data (not
 * site-scoped): a code -> plate lookup shared by every citerne, so both a
 * SuperAdmin and a responsable can maintain it. Changing a matricule here is
 * reflected immediately everywhere (the Global view joins on code at read
 * time, nothing is copied).
 */
class FuelVehicleController extends Controller
{
    use ReceivesExcelUpload;

    public function index(Request $request)
    {
        $query = FuelVehicle::query()->orderBy('code');

        if ($search = $request->query('search')) {
            $query->where(fn ($q) => $q->where('code', 'like', "%{$search}%")->orWhere('matricule', 'like', "%{$search}%")->orWhere('type', 'like', "%{$search}%"));
        }

        $page = $query->paginate((int) $request->query('per_page', 25));

        // Codes keyed in at a pump that the matriculation doesn't know yet:
        // exactly what leaves an "Immatriculation" cell empty in Global.
        $unknown = DB::table('fuel_movements as m')
            ->leftJoin('fuel_vehicles as v', 'v.code', '=', 'm.vehicle_code')
            ->where('m.type', 'exit')
            ->whereNotNull('m.vehicle_code')
            ->whereNull('v.id')
            ->groupBy('m.vehicle_code')
            ->orderByDesc(DB::raw('COUNT(*)'))
            ->limit(50)
            ->get([DB::raw('m.vehicle_code as code'), DB::raw('COUNT(*) as refuels'), DB::raw('SUM(m.quantity) as litres')]);

        return response()->json([
            ...$page->toArray(),
            'unknown_codes' => $unknown,
            'total_vehicles' => FuelVehicle::count(),
        ]);
    }

    public function store(Request $request, FuelConsumptionService $consumption)
    {
        $vehicle = FuelVehicle::create($this->validated($request));
        if ($vehicle->unit || $vehicle->brand) {
            $consumption->recalculate();
        }
        AuditLogger::log('fuel.vehicle_created', "Matricule {$vehicle->code} → {$vehicle->matricule} ajouté", null, $vehicle);

        return response()->json($vehicle, 201);
    }

    public function update(Request $request, FuelVehicle $fuelVehicle, FuelConsumptionService $consumption)
    {
        $data = $this->validated($request, $fuelVehicle);
        $unitChanged = ($data['unit'] ?? null) !== $fuelVehicle->unit || ($data['brand'] ?? null) !== $fuelVehicle->brand;
        $fuelVehicle->update($data);
        if ($unitChanged) {
            $consumption->recalculate();
        }
        AuditLogger::log('fuel.vehicle_updated', "Matricule {$fuelVehicle->code} → {$fuelVehicle->matricule} modifié", null, $fuelVehicle);

        return response()->json($fuelVehicle);
    }

    public function destroy(FuelVehicle $fuelVehicle)
    {
        $fuelVehicle->delete();
        AuditLogger::log('fuel.vehicle_deleted', "Matricule {$fuelVehicle->code} supprimé", null, $fuelVehicle);

        return response()->noContent();
    }

    public function import(Request $request, FuelImportService $importer, FuelConsumptionService $consumption)
    {
        $file = $this->excelUpload($request);

        $result = $importer->importVehicles($file->getRealPath(), $file->getClientOriginalName());
        // A "Marque" column can change camions' counter unit.
        $consumption->recalculate();
        AuditLogger::log('fuel.vehicles_imported', "Matriculation importée depuis {$file->getClientOriginalName()} ({$result['created']} ajoutés, {$result['updated']} mis à jour)", null, new FuelVehicle());

        return response()->json($result);
    }

    protected function validated(Request $request, ?FuelVehicle $vehicle = null): array
    {
        $request->merge(['code' => FuelVehicle::normalizeCode($request->input('code'))]);

        return $request->validate([
            'code' => ['required', 'string', 'max:60', Rule::unique('fuel_vehicles', 'code')->ignore($vehicle?->id)],
            'matricule' => ['required', 'string', 'max:120'],
            'type' => ['nullable', 'string', 'max:60'],
            'brand' => ['nullable', Rule::in(array_keys(FuelVehicle::BRAND_UNITS))],
            'unit' => ['nullable', Rule::in(['km', 'h'])],
        ], ['code.unique' => 'Ce code existe déjà.']);
    }
}
