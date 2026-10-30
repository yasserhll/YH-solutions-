<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Concerns\ResolvesSingleSite;
use App\Http\Controllers\Controller;
use App\Models\FuelMovement;
use App\Models\FuelVehicle;
use App\Models\Site;
use App\Services\ExcelExportService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Consommation > Global: the app's version of global.xlsx, built
 * automatically from every imported citerne (one line per SORTIE, with
 * Compteur début / Parcours / Consommation derived by
 * FuelConsumptionService) — no copy/paste or VLOOKUP to get wrong. A line
 * can still be added/fixed/removed by hand (FuelMovementController), and
 * that correction survives the next re-import. The on-screen table and the Excel
 * export share globalQuery() so they can never drift.
 */
class FuelGlobalController extends Controller
{
    use InteractsWithSites, ResolvesSingleSite;

    /**
     * A SORTIE to another citerne (code "CIT85751", or a matriculation entry
     * typed "Citerne") moves fuel between tanks, it isn't burnt by an engine:
     * shown in the table, but kept out of every consumption KPI/chart so the
     * mobile citerne doesn't show up as the "biggest consumer".
     */
    protected const TRANSFER_SQL = "(COALESCE(fuel_movements.vehicle_code, '') LIKE 'CIT%' OR COALESCE(v.type, '') = 'Citerne')";

    public function index(Request $request)
    {
        $rows = $this->globalQuery($request)
            ->orderByDesc('fuel_movements.date')->orderByDesc('fuel_movements.time')->orderByDesc('fuel_movements.id')
            ->paginate((int) $request->query('per_page', 25));
        $rows->getCollection()->transform(fn ($row) => $this->shape($row));

        $site = Site::find($this->singleSiteId($request), ['id', 'name', 'truck_unit']);

        return response()->json([...$rows->toArray(), 'site' => $site, 'summary' => $this->summary($request)]);
    }

    public function export(Request $request, ExcelExportService $excel)
    {
        // Same layout as the company's own global.xlsx (see
        // ExcelExportService::streamFuelGlobal), same rows/filters as the screen.
        $rows = $this->globalQuery($request)
            ->orderBy('fuel_movements.date')->orderBy('fuel_movements.time')->orderBy('fuel_movements.id')
            ->get()
            ->map(fn ($row) => $this->shape($row))
            ->all();

        $filename = 'global-'.str(Site::find($this->singleSiteId($request))?->name)->slug().'.xlsx';

        return $excel->streamFuelGlobal($filename, $rows);
    }

    protected function globalQuery(Request $request, bool $applyRowFilters = true): Builder
    {
        $query = FuelMovement::query()
            ->join('fuel_tanks as t', 't.id', '=', 'fuel_movements.fuel_tank_id')
            ->join('sites as s', 's.id', '=', 'fuel_movements.site_id')
            ->leftJoin('fuel_vehicles as v', 'v.code', '=', 'fuel_movements.vehicle_code')
            ->where('fuel_movements.type', 'exit')
            ->select('fuel_movements.*', 'v.matricule', 'v.type as vehicle_type', 'v.unit as vehicle_unit', 'v.brand as vehicle_brand', 't.name as tank_name', 's.name as site_name', 's.truck_unit as site_truck_unit')
            ->selectRaw(self::TRANSFER_SQL.' as is_transfer');
        $query->where('fuel_movements.site_id', $this->singleSiteId($request));

        if ($from = $request->query('date_from')) {
            $query->where('fuel_movements.date', '>=', $from);
        }
        if ($to = $request->query('date_to')) {
            $query->where('fuel_movements.date', '<=', $to);
        }
        if ($tankId = $request->query('tank_id')) {
            $query->where('fuel_movements.fuel_tank_id', $tankId);
        }
        if (! $applyRowFilters) {
            return $query;
        }

        if ($search = $request->query('search')) {
            $query->where(fn ($q) => $q->where('fuel_movements.vehicle_code', 'like', "%{$search}%")
                ->orWhere('v.matricule', 'like', "%{$search}%")
                ->orWhere('fuel_movements.remark', 'like', "%{$search}%"));
        }
        if ($code = $request->query('code')) {
            $query->where('fuel_movements.vehicle_code', $code);
        }
        match ($request->query('anomaly')) {
            'negative' => $query->where('fuel_movements.distance', '<', 0),
            'no_counter' => $query->whereNull('fuel_movements.odometer'),
            'unknown' => $query->whereNotNull('fuel_movements.vehicle_code')->whereNull('v.id'),
            'transfer' => $query->whereRaw(self::TRANSFER_SQL),
            default => null,
        };

        return $query;
    }

    protected function shape($row): array
    {
        return [
            'id' => $row->id,
            'date' => $row->date?->toDateString(),
            'time' => $row->time,
            'code' => $row->vehicle_code,
            'matricule' => $row->matricule,
            'vehicle_type' => $row->vehicle_type,
            'odometer' => $row->odometer,
            'previous_odometer' => $row->previous_odometer,
            'distance' => $row->distance,
            'quantity' => $row->quantity,
            'consumption' => $row->is_transfer ? null : $row->consumption,
            'is_transfer' => (bool) $row->is_transfer,
            'unit' => FuelVehicle::unitFor($row->vehicle_code, $row->vehicle_unit, $row->site_truck_unit, $row->vehicle_brand),
            'remark' => $row->remark,
            'bon_number' => $row->bon_number,
            'fuel_tank_id' => $row->fuel_tank_id,
            'origin' => $row->origin,
            'edited' => (bool) $row->edited,
            'tank' => $row->tank_name,
            'site' => $row->site_name,
        ];
    }

    /** KPIs + chart series for the same filter window as the table (search/anomaly aside). */
    protected function summary(Request $request): array
    {
        $base = fn () => $this->globalQuery($request, false)->reorder()->whereRaw('NOT '.self::TRANSFER_SQL);
        $transfers = $this->globalQuery($request, false)->reorder()->whereRaw(self::TRANSFER_SQL)
            ->select(DB::raw('COALESCE(SUM(fuel_movements.quantity), 0) as litres'), DB::raw('COUNT(*) as n'))->first();
        $isKm = FuelVehicle::KM_SQL;

        $totals = $base()->select([
            DB::raw('COALESCE(SUM(fuel_movements.quantity), 0) as litres'),
            DB::raw('COUNT(*) as refuels'),
            DB::raw('COUNT(DISTINCT fuel_movements.vehicle_code) as vehicles'),
            DB::raw('SUM(fuel_movements.distance < 0) as negative'),
            DB::raw('SUM(fuel_movements.odometer IS NULL) as no_counter'),
            DB::raw('SUM(fuel_movements.vehicle_code IS NOT NULL AND v.id IS NULL) as unknown'),
            DB::raw("SUM(CASE WHEN fuel_movements.distance > 0 AND {$isKm} THEN fuel_movements.quantity END) as km_litres"),
            DB::raw("SUM(CASE WHEN fuel_movements.distance > 0 AND {$isKm} THEN fuel_movements.distance END) as km_distance"),
            DB::raw("SUM(CASE WHEN fuel_movements.distance > 0 AND NOT ({$isKm}) THEN fuel_movements.quantity END) as h_litres"),
            DB::raw("SUM(CASE WHEN fuel_movements.distance > 0 AND NOT ({$isKm}) THEN fuel_movements.distance END) as h_hours"),
            DB::raw('MIN(fuel_movements.date) as date_from'),
            DB::raw('MAX(fuel_movements.date) as date_to'),
        ])->first();

        // Deliveries into the citernes over the same window.
        $entries = FuelMovement::query()->where('type', 'entry');
        $entries->where('site_id', $this->singleSiteId($request));
        if ($from = $request->query('date_from')) {
            $entries->where('date', '>=', $from);
        }
        if ($to = $request->query('date_to')) {
            $entries->where('date', '<=', $to);
        }
        if ($tankId = $request->query('tank_id')) {
            $entries->where('fuel_tank_id', $tankId);
        }

        $daily = $base()->select([
            'fuel_movements.date',
            DB::raw('SUM(fuel_movements.quantity) as litres'),
            DB::raw('COUNT(*) as refuels'),
        ])->groupBy('fuel_movements.date')->orderBy('fuel_movements.date')->get()
            ->map(fn ($r) => ['date' => $r->date->toDateString(), 'litres' => (float) $r->litres, 'refuels' => (int) $r->refuels]);

        $topVehicles = $base()->whereNotNull('fuel_movements.vehicle_code')->select([
            DB::raw('fuel_movements.vehicle_code as code'),
            DB::raw('MAX(v.matricule) as matricule'),
            DB::raw('MAX(v.unit) as vehicle_unit'),
            DB::raw('MAX(s.truck_unit) as site_truck_unit'),
            DB::raw('MAX(v.brand) as vehicle_brand'),
            DB::raw('SUM(fuel_movements.quantity) as litres'),
            DB::raw('COUNT(*) as refuels'),
            DB::raw('SUM(CASE WHEN fuel_movements.distance > 0 THEN fuel_movements.quantity END) as litres_measured'),
            DB::raw('SUM(CASE WHEN fuel_movements.distance > 0 THEN fuel_movements.distance END) as distance'),
        ])->groupBy('fuel_movements.vehicle_code')->orderByDesc('litres')->limit(10)->get()
            ->map(function ($r) {
                $unit = FuelVehicle::unitFor($r->code, $r->vehicle_unit, $r->site_truck_unit, $r->vehicle_brand);
                $avg = $r->distance > 0 ? $r->litres_measured / $r->distance * ($unit === 'km' ? 100 : 1) : null;

                return ['code' => $r->code, 'matricule' => $r->matricule, 'litres' => (float) $r->litres, 'refuels' => (int) $r->refuels, 'unit' => $unit, 'avg_consumption' => $avg !== null ? round($avg, 2) : null];
            });

        $byTank = $base()->select([
            't.id', DB::raw('t.name as name'), DB::raw('s.name as site'),
            DB::raw('SUM(fuel_movements.quantity) as litres'), DB::raw('COUNT(*) as refuels'),
        ])->groupBy('t.id', 't.name', 's.name')->orderByDesc('litres')->get()
            ->map(fn ($r) => ['id' => $r->id, 'name' => $r->name, 'site' => $r->site, 'litres' => (float) $r->litres, 'refuels' => (int) $r->refuels]);

        return [
            'litres_out' => (float) $totals->litres,
            'litres_in' => (float) $entries->sum('quantity'),
            'refuels' => (int) $totals->refuels,
            'vehicles' => (int) $totals->vehicles,
            'avg_l_100km' => $totals->km_distance > 0 ? round($totals->km_litres / $totals->km_distance * 100, 2) : null,
            'avg_l_h' => $totals->h_hours > 0 ? round($totals->h_litres / $totals->h_hours, 2) : null,
            'transfers' => ['litres' => (float) $transfers->litres, 'count' => (int) $transfers->n],
            'anomalies' => ['negative' => (int) $totals->negative, 'no_counter' => (int) $totals->no_counter, 'unknown' => (int) $totals->unknown],
            'date_from' => $totals->date_from,
            'date_to' => $totals->date_to,
            'daily' => $daily,
            'top_vehicles' => $topVehicles,
            'by_tank' => $byTank,
        ];
    }
}
