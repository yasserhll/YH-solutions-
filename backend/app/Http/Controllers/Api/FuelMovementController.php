<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\FuelMovement;
use App\Models\FuelMovementOverride;
use App\Models\FuelTank;
use App\Models\FuelVehicle;
use App\Services\AuditLogger;
use App\Services\FuelConsumptionService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Hand corrections from Consommation > Global: add a SORTIE the Excel file
 * missed, fix a typo'd code/counter/quantity, or remove a bogus line.
 *
 * Every correction survives the next re-import of the citerne's Excel file:
 * an added row is `origin = manual` (never deleted by an import), and an
 * edit/deletion of an imported row is recorded as a FuelMovementOverride
 * that FuelImportService re-applies. Compteur début / Parcours /
 * Consommation are never typed — the whole chain is recalculated after
 * each change, exactly like after an import.
 */
class FuelMovementController extends Controller
{
    use InteractsWithSites;

    public function __construct(protected FuelConsumptionService $consumption) {}

    public function store(Request $request)
    {
        $data = $this->validated($request);
        $tank = FuelTank::findOrFail($request->input('fuel_tank_id'));
        $this->ensureSiteAccess($request, $tank->site_id);

        $movement = FuelMovement::create($data + [
            'fuel_tank_id' => $tank->id,
            'site_id' => $tank->site_id,
            'type' => 'exit',
            'origin' => 'manual',
        ]);
        $this->consumption->recalculate();
        AuditLogger::log('fuel.movement_created', "Sortie ajoutée à la main : {$movement->vehicle_code}, {$movement->quantity} L le {$movement->date->format('d/m/Y')} ({$tank->name})", $tank->site_id, $movement);

        return response()->json($movement, 201);
    }

    public function update(Request $request, FuelMovement $fuelMovement)
    {
        $this->ensureEditable($request, $fuelMovement);
        $data = $this->validated($request);
        $old = $fuelMovement->only(array_keys($data));

        DB::transaction(function () use ($request, $fuelMovement, $data) {
            if ($fuelMovement->origin === 'manual') {
                // A hand-added row can also move to another citerne of the same site.
                $tank = FuelTank::findOrFail($request->input('fuel_tank_id', $fuelMovement->fuel_tank_id));
                abort_if($tank->site_id !== $fuelMovement->site_id, 422, 'La citerne doit appartenir au même site.');
                $fuelMovement->update($data + ['fuel_tank_id' => $tank->id]);

                return;
            }

            $this->remember($request, $fuelMovement, 'update', $data);
            $fuelMovement->update($data + ['edited' => true]);
        });

        $this->consumption->recalculate();
        AuditLogger::log('fuel.movement_updated', "Sortie {$fuelMovement->vehicle_code} du {$fuelMovement->date->format('d/m/Y')} modifiée depuis le Global", $fuelMovement->site_id, $fuelMovement, $old, $data);

        return response()->json($fuelMovement->fresh());
    }

    public function destroy(Request $request, FuelMovement $fuelMovement)
    {
        $this->ensureEditable($request, $fuelMovement);

        DB::transaction(function () use ($request, $fuelMovement) {
            if ($fuelMovement->origin === 'import') {
                $this->remember($request, $fuelMovement, 'delete');
            }
            $fuelMovement->delete();
        });

        $this->consumption->recalculate();
        AuditLogger::log('fuel.movement_deleted', "Sortie {$fuelMovement->vehicle_code} ({$fuelMovement->quantity} L) du {$fuelMovement->date->format('d/m/Y')} supprimée depuis le Global", $fuelMovement->site_id, $fuelMovement);

        return response()->noContent();
    }

    protected function ensureEditable(Request $request, FuelMovement $movement): void
    {
        $this->ensureSiteAccess($request, $movement->site_id);
        abort_if($movement->type !== 'exit', 422, 'Seules les sorties du Global peuvent être modifiées ici.');
    }

    protected function remember(Request $request, FuelMovement $movement, string $action, ?array $data = null): void
    {
        FuelMovementOverride::updateOrCreate(
            ['fuel_tank_id' => $movement->fuel_tank_id, 'fingerprint' => $movement->fingerprint],
            ['action' => $action, 'data' => $data, 'user_id' => $request->user()?->id],
        );
    }

    protected function validated(Request $request): array
    {
        $request->merge(['vehicle_code' => FuelVehicle::normalizeCode($request->input('vehicle_code'))]);

        $data = $request->validate([
            'fuel_tank_id' => [$request->isMethod('post') ? 'required' : 'sometimes', 'integer', 'exists:fuel_tanks,id'],
            'date' => ['required', 'date'],
            'time' => ['nullable', 'date_format:H:i'],
            'vehicle_code' => ['required', 'string', 'max:60'],
            'odometer' => ['nullable', 'numeric', 'min:0'],
            'quantity' => ['required', 'numeric', 'gt:0', 'max:100000'],
            'remark' => ['nullable', 'string', 'max:255'],
        ], [
            'quantity.gt' => 'La quantité doit être supérieure à 0.',
        ]);
        unset($data['fuel_tank_id']);
        $data['time'] = isset($data['time']) ? $data['time'].':00' : null;

        return $data;
    }
}
