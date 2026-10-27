<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\FuelMovement;
use App\Models\FuelTank;
use App\Services\AuditLogger;
use App\Services\FuelConsumptionService;
use App\Services\FuelImportService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Consommation > Citernes. Fed only by Excel import (a re-import replaces
 * the citerne's rows, see FuelImportService), site-scoped like everything
 * else via InteractsWithSites.
 */
class FuelTankController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = FuelTank::with(['site:id,name', 'importer:id,name'])->orderBy('name');
        $this->scopeToSite($query, $request);
        $tanks = $query->get();
        $ids = $tanks->pluck('id');

        $stats = DB::table('fuel_movements')
            ->whereIn('fuel_tank_id', $ids)
            ->groupBy('fuel_tank_id')
            ->get([
                'fuel_tank_id',
                DB::raw("SUM(CASE WHEN type = 'entry' THEN quantity ELSE 0 END) as litres_in"),
                DB::raw("SUM(CASE WHEN type = 'exit' THEN quantity ELSE 0 END) as litres_out"),
                DB::raw("SUM(type = 'entry') as entries"),
                DB::raw("SUM(type = 'exit') as exits"),
                DB::raw('MIN(date) as date_from'),
                DB::raw('MAX(date) as date_to'),
                DB::raw('COUNT(DISTINCT vehicle_code) as vehicles'),
            ])->keyBy('fuel_tank_id');

        // Pump index (SERIE FIN) on each citerne's most recent line.
        $lastSerie = DB::table('fuel_movements as m')
            ->whereIn('m.fuel_tank_id', $ids)
            ->whereRaw('m.id = (SELECT MAX(x.id) FROM fuel_movements x WHERE x.fuel_tank_id = m.fuel_tank_id AND x.serie_end IS NOT NULL)')
            ->pluck('m.serie_end', 'm.fuel_tank_id');

        // Last 30 days of exits per citerne, for the sparkline on each card.
        $since = DB::table('fuel_movements')->whereIn('fuel_tank_id', $ids)->max('date');
        $spark = $since === null ? collect() : DB::table('fuel_movements')
            ->whereIn('fuel_tank_id', $ids)
            ->where('type', 'exit')
            ->where('date', '>', now()->parse($since)->subDays(30)->toDateString())
            ->groupBy('fuel_tank_id', 'date')
            ->orderBy('date')
            ->get(['fuel_tank_id', 'date', DB::raw('SUM(quantity) as litres')])
            ->groupBy('fuel_tank_id');

        return $tanks->map(function (FuelTank $tank) use ($stats, $lastSerie, $spark) {
            $s = $stats[$tank->id] ?? null;

            return [
                'id' => $tank->id,
                'name' => $tank->name,
                'site' => $tank->site,
                'last_import_file' => $tank->last_import_file,
                'last_imported_at' => $tank->last_imported_at,
                'last_imported_by' => $tank->importer?->name,
                'litres_in' => (float) ($s->litres_in ?? 0),
                'litres_out' => (float) ($s->litres_out ?? 0),
                'entries' => (int) ($s->entries ?? 0),
                'exits' => (int) ($s->exits ?? 0),
                'vehicles' => (int) ($s->vehicles ?? 0),
                'date_from' => $s->date_from ?? null,
                'date_to' => $s->date_to ?? null,
                'last_serie' => isset($lastSerie[$tank->id]) ? (float) $lastSerie[$tank->id] : null,
                'spark' => ($spark[$tank->id] ?? collect())->map(fn ($r) => ['date' => $r->date, 'litres' => (float) $r->litres])->values(),
            ];
        })->values();
    }

    public function import(Request $request, FuelImportService $importer)
    {
        $request->validate(['file' => ['required', 'file', 'mimes:xlsx', 'max:40960']]);
        $siteId = $this->resolveSiteId($request);
        $file = $request->file('file');
        $filename = $file->getClientOriginalName();

        $summaries = $importer->importTanks($file->getRealPath(), $filename, $siteId, $request->user()->id);

        foreach ($summaries as $summary) {
            AuditLogger::log('fuel.tank_imported', "Citerne {$summary['tank']} importée depuis {$filename} ({$summary['rows']} lignes)", $siteId, FuelTank::find($summary['tank_id']));
        }

        return response()->json(['file' => $filename, 'tanks' => $summaries]);
    }

    public function destroy(Request $request, FuelTank $fuelTank, FuelConsumptionService $consumption)
    {
        $this->ensureSiteAccess($request, $fuelTank->site_id);
        $fuelTank->delete();
        $consumption->recalculate();
        AuditLogger::log('fuel.tank_deleted', "Citerne {$fuelTank->name} supprimée", $fuelTank->site_id, $fuelTank);

        return response()->noContent();
    }

    /** The raw lines of one citerne (or every citerne in scope), newest first. */
    public function movements(Request $request)
    {
        $query = FuelMovement::query()
            ->leftJoin('fuel_vehicles as v', 'v.code', '=', 'fuel_movements.vehicle_code')
            ->select('fuel_movements.*', 'v.matricule');
        $this->scopeToSite($query, $request, 'fuel_movements.site_id');

        if ($tankId = $request->query('tank_id')) {
            $query->where('fuel_movements.fuel_tank_id', $tankId);
        }
        if (in_array($type = $request->query('type'), ['entry', 'exit'], true)) {
            $query->where('fuel_movements.type', $type);
        }
        if ($from = $request->query('date_from')) {
            $query->where('fuel_movements.date', '>=', $from);
        }
        if ($to = $request->query('date_to')) {
            $query->where('fuel_movements.date', '<=', $to);
        }
        if ($search = $request->query('search')) {
            $query->where(fn ($q) => $q->where('fuel_movements.vehicle_code', 'like', "%{$search}%")
                ->orWhere('v.matricule', 'like', "%{$search}%")
                ->orWhere('fuel_movements.bon_number', 'like', "%{$search}%")
                ->orWhere('fuel_movements.supplier', 'like', "%{$search}%"));
        }

        return $query->orderByDesc('fuel_movements.date')->orderByDesc('fuel_movements.time')->orderByDesc('fuel_movements.id')
            ->paginate((int) $request->query('per_page', 25));
    }
}
