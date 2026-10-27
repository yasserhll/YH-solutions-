<?php

namespace App\Services;

use App\Models\FuelVehicle;
use Illuminate\Support\Facades\DB;

/**
 * Derives the "GLOBAL" sheet's computed columns for every SORTIE, across
 * every citerne of the SAME site (a vehicle refuelled at Louta 1 yesterday
 * and from Louta's mobile citerne today chains its counters across both,
 * but never across two sites — each site's global stands on its own): Compteur début = the same vehicle's previous Compteur fin,
 * Parcours = fin - début, Consommation = litres / parcours (L/100 km for a
 * km vehicle, L/h for an hour-metered engine — see FuelVehicle::unitFor).
 *
 * Same "derived ledger" philosophy as CashLedgerService/OvertimeLedgerService:
 * recomputed in full after every import, never typed in by hand, so it can't
 * drift from the source rows. Only rows whose values actually changed are
 * written back.
 */
class FuelConsumptionService
{
    public function recalculate(): void
    {
        $rows = DB::table('fuel_movements')
            ->where('type', 'exit')
            ->whereNotNull('vehicle_code')
            ->orderBy('site_id')
            ->orderBy('vehicle_code')
            ->orderBy('date')
            ->orderBy('time')
            ->orderBy('id')
            ->get(['id', 'site_id', 'vehicle_code', 'odometer', 'quantity', 'previous_odometer', 'distance', 'consumption']);

        $units = DB::table('fuel_vehicles')->whereNotNull('unit')->pluck('unit', 'code');
        $changes = [];
        $currentKey = null;
        $previous = null;

        foreach ($rows as $row) {
            // Each site's global is self-contained (like one global.xlsx per
            // site): a vehicle's counter chain never crosses into another site.
            $key = $row->site_id.'|'.$row->vehicle_code;
            if ($key !== $currentKey) {
                $currentKey = $key;
                $previous = null;
            }

            // A row without its own counter reading keeps no "début" either
            // (nothing to subtract from), and doesn't break the chain: the
            // next reading still compares against the last known one.
            $odometer = $row->odometer === null ? null : (float) $row->odometer;
            $start = $odometer !== null ? $previous : null;
            $distance = $start !== null ? round($odometer - $start, 2) : null;
            $consumption = null;
            if ($distance !== null && $distance > 0) {
                $perUnit = (float) $row->quantity / $distance;
                $consumption = round(FuelVehicle::unitFor($row->vehicle_code, $units[$row->vehicle_code] ?? null) === 'km' ? $perUnit * 100 : $perUnit, 4);
            }

            if (! $this->same($row->previous_odometer, $start)
                || ! $this->same($row->distance, $distance)
                || ! $this->same($row->consumption, $consumption)) {
                $changes[] = [$row->id, $start, $distance, $consumption];
            }

            if ($odometer !== null) {
                $previous = $odometer;
            }
        }

        foreach (array_chunk($changes, 500) as $chunk) {
            $this->bulkUpdate($chunk);
        }

        // Exits without a code can't chain to anything.
        DB::table('fuel_movements')
            ->where('type', 'exit')
            ->whereNull('vehicle_code')
            ->where(fn ($q) => $q->whereNotNull('distance')->orWhereNotNull('consumption')->orWhereNotNull('previous_odometer'))
            ->update(['previous_odometer' => null, 'distance' => null, 'consumption' => null]);
    }

    protected function same(mixed $stored, ?float $computed): bool
    {
        if ($stored === null || $computed === null) {
            return $stored === null && $computed === null;
        }

        return abs((float) $stored - $computed) < 0.0001;
    }

    /** @param  array<int, array{0: int, 1: ?float, 2: ?float, 3: ?float}>  $chunk */
    protected function bulkUpdate(array $chunk): void
    {
        $ids = [];
        $cases = ['previous_odometer' => [], 'distance' => [], 'consumption' => []];
        $bindings = ['previous_odometer' => [], 'distance' => [], 'consumption' => []];

        foreach ($chunk as [$id, $previous, $distance, $consumption]) {
            $ids[] = $id;
            foreach (['previous_odometer' => $previous, 'distance' => $distance, 'consumption' => $consumption] as $column => $value) {
                $cases[$column][] = 'WHEN ? THEN ?';
                array_push($bindings[$column], $id, $value);
            }
        }

        $sets = [];
        $allBindings = [];
        foreach ($cases as $column => $whens) {
            $sets[] = "`{$column}` = CASE `id` ".implode(' ', $whens).' END';
            array_push($allBindings, ...$bindings[$column]);
        }
        array_push($allBindings, ...$ids);

        DB::update(
            'UPDATE `fuel_movements` SET '.implode(', ', $sets).' WHERE `id` IN ('.implode(',', array_fill(0, count($ids), '?')).')',
            $allBindings
        );
    }
}
