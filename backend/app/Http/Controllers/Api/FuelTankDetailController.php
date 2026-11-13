<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\FuelTank;
use App\Models\Site;
use App\Services\ExcelExportService;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * "Détail citernes": each citerne shown line by line exactly like its Excel
 * sheet (the company's "citerne louta 3.xlsx" layout: Date | ENTREE Qte,
 * Fournisseur | SORTIES N° de bon … Remarque | SERIE DEPART | SERIE FIN),
 * from the same `fuel_movements` rows as the Global — imported lines, bons
 * typed by the pompistes and hand-added lines alike — and exported as a
 * replica of that sheet (ExcelExportService::streamTankSheet).
 *
 * An Excel line holding both an ENTREE and a SORTIE is stored as two rows
 * sharing its `source_row`; they are put back on one line here.
 */
class FuelTankDetailController extends Controller
{
    use InteractsWithSites;

    /** The citernes of the user's sites with their totals. */
    public function tanks(Request $request)
    {
        $sites = $this->scopeToSite(Site::query()->select('id'), $request, 'id');
        $tanks = FuelTank::with('site:id,name')->whereIn('site_id', $sites)
            ->orderBy('site_id')->orderBy('name')->get();

        $stats = DB::table('fuel_movements')
            ->whereIn('fuel_tank_id', $tanks->pluck('id'))
            ->groupBy('fuel_tank_id')
            ->get([
                'fuel_tank_id',
                DB::raw("SUM(CASE WHEN type = 'entry' THEN quantity ELSE 0 END) as litres_in"),
                DB::raw("SUM(CASE WHEN type = 'exit' THEN quantity ELSE 0 END) as litres_out"),
                DB::raw("SUM(type = 'exit') as exits"),
                DB::raw("SUM(type = 'entry') as entries"),
                DB::raw("SUM(origin = 'bon') as bons"),
                DB::raw('MIN(date) as date_from'),
                DB::raw('MAX(date) as date_to'),
            ])->keyBy('fuel_tank_id');

        // The pump index the next line starts from: the latest line's série fin
        // (by date, hour, série) — not the highest id, a re-import renumbers the
        // Excel lines after the bons typed in the app.
        $series = $tanks->mapWithKeys(fn (FuelTank $tank) => [$tank->id => DB::table('fuel_movements')
            ->where('fuel_tank_id', $tank->id)->whereNotNull('serie_end')
            ->orderByDesc('date')->orderByDesc('serie_end')
            ->value('serie_end')]);

        return response()->json($tanks->map(function (FuelTank $tank) use ($stats, $series) {
            $s = $stats[$tank->id] ?? null;

            return [
                'id' => $tank->id,
                'name' => $tank->name,
                'site' => $tank->site,
                'litres_in' => round((float) ($s->litres_in ?? 0), 2),
                'litres_out' => round((float) ($s->litres_out ?? 0), 2),
                'entries' => (int) ($s->entries ?? 0),
                'exits' => (int) ($s->exits ?? 0),
                'bons' => (int) ($s->bons ?? 0),
                'date_from' => $s->date_from ?? null,
                'date_to' => $s->date_to ?? null,
                'last_serie' => isset($series[$tank->id]) ? (float) $series[$tank->id] : null,
            ];
        }));
    }

    /** One page of the citerne's lines: the sheet's order, or newest first with `order=desc`; `page=last` opens on the last page. */
    public function index(Request $request)
    {
        $tank = $this->tank($request);
        $query = $this->linesQuery($request, $tank);

        $totals = (clone $query)->selectRaw("
            COALESCE(SUM(CASE WHEN m.type = 'entry' THEN m.quantity END), 0) as litres_in,
            COALESCE(SUM(CASE WHEN m.type = 'exit' THEN m.quantity END), 0) as litres_out,
            COALESCE(SUM(m.type = 'exit'), 0) as exits,
            COALESCE(SUM(m.type = 'entry'), 0) as entries")->first();

        $perPage = min(max((int) $request->query('per_page', 100), 10), 500);
        $count = (clone $query)->count();
        $lastPage = max(1, (int) ceil($count / $perPage));
        $page = $request->query('page') === 'last' ? $lastPage : min(max((int) $request->query('page', 1), 1), $lastPage);

        // On screen the newest lines come first (`order=desc`, page 1 = the latest);
        // the export keeps the sheet's own order. Lines are merged in the sheet's
        // order (an ENTREE before its SORTIE), then turned back.
        $newestFirst = $request->query('order') === 'desc';
        $rows = $this->ordered($query, $newestFirst)->forPage($page, $perPage)->get();
        $lines = $newestFirst ? array_reverse($this->mergeLines($rows->reverse()->values())) : $this->mergeLines($rows);

        return response()->json([
            'data' => $lines,
            'current_page' => $page,
            'last_page' => $lastPage,
            'per_page' => $perPage,
            'total' => $count,
            'totals' => [
                'litres_in' => round((float) $totals->litres_in, 2),
                'litres_out' => round((float) $totals->litres_out, 2),
                'entries' => (int) $totals->entries,
                'exits' => (int) $totals->exits,
            ],
        ]);
    }

    /** The citerne exported as its Excel sheet (same filters as the screen). */
    public function export(Request $request, ExcelExportService $excel)
    {
        @set_time_limit(300);
        @ini_set('memory_limit', '1024M');
        $tank = $this->tank($request);
        $lines = $this->mergeLines($this->ordered($this->linesQuery($request, $tank))->get());

        $suffix = $request->query('date_from') || $request->query('date_to')
            ? '-'.($request->query('date_from') ?: 'debut').'-'.($request->query('date_to') ?: 'fin')
            : '';

        return $excel->streamTankSheet('citerne-'.Str::slug($tank->name).$suffix.'.xlsx', $tank->name, $lines);
    }

    protected function tank(Request $request): FuelTank
    {
        $id = $request->query('fuel_tank_id');
        abort_if(! $id, 422, 'Choisissez une citerne.');
        $tank = FuelTank::findOrFail($id);
        $this->ensureSiteAccess($request, $tank->site_id);

        return $tank;
    }

    protected function linesQuery(Request $request, FuelTank $tank): Builder
    {
        return DB::table('fuel_movements as m')
            ->leftJoin('fuel_vehicles as v', 'v.code', '=', 'm.vehicle_code')
            ->where('m.fuel_tank_id', $tank->id)
            ->when($request->query('date_from'), fn ($q, $d) => $q->where('m.date', '>=', $d))
            ->when($request->query('date_to'), fn ($q, $d) => $q->where('m.date', '<=', $d))
            ->when(in_array($request->query('type'), ['entry', 'exit'], true), fn ($q) => $q->where('m.type', $request->query('type')))
            ->when($request->query('search'), function ($q, $search) {
                $like = '%'.trim($search).'%';
                $q->where(fn ($w) => $w->where('m.bon_number', 'like', $like)
                    ->orWhere('m.vehicle_code', 'like', $like)
                    ->orWhere('v.matricule', 'like', $like)
                    ->orWhere('m.plate_label', 'like', $like)
                    ->orWhere('m.supplier', 'like', $like)
                    ->orWhere('m.remark', 'like', $like));
            });
    }

    /**
     * The sheet's order: day by day, then the pump index (série départ) —
     * the order the pompiste served in, which is the order of the sheet's
     * lines even when the hours are not (16:04 written above 16:00). A line
     * without séries falls back on its hour; an ENTREE comes before the
     * SORTIE of its line (same série, lower id).
     */
    protected function ordered(Builder $query, bool $newestFirst = false): Builder
    {
        $dir = $newestFirst ? 'desc' : 'asc';

        return $query
            ->select('m.id', 'm.type', 'm.date', 'm.time', 'm.quantity', 'm.supplier', 'm.bon_number', 'm.vehicle_code',
                'm.odometer', 'm.serie_start', 'm.serie_end', 'm.remark', 'm.origin', 'm.source_row')
            ->selectRaw('COALESCE(m.plate_label, v.matricule) as matricule')
            ->selectRaw('(SELECT COUNT(*) FROM fuel_bon_attachments a WHERE a.fuel_movement_id = m.id) as attachments_count')
            ->orderBy('m.date', $dir)
            ->orderByRaw('m.serie_start IS NULL '.$dir)
            ->orderBy('m.serie_start', $dir)
            ->orderByRaw("COALESCE(m.time, '00:00:00') ".$dir)
            ->orderBy('m.id', $dir);
    }

    /**
     * One array per sheet line: an ENTREE and the SORTIE written on the same
     * Excel line (same source_row, stored as two rows) become one line again.
     *
     * @return array<int, array<string, mixed>>
     */
    protected function mergeLines(iterable $rows): array
    {
        $lines = [];
        $pendingEntry = null;
        $flush = function () use (&$pendingEntry, &$lines) {
            if ($pendingEntry) {
                $lines[] = $pendingEntry;
                $pendingEntry = null;
            }
        };

        foreach ($rows as $r) {
            $line = [
                'id' => $r->id,
                'date' => $r->date,
                'time' => $r->time,
                'entry_qty' => null,
                'supplier' => null,
                'bon_number' => null,
                'code' => null,
                'matricule' => null,
                'odometer' => null,
                'exit_qty' => null,
                'remark' => $r->remark,
                'serie_start' => $r->serie_start === null ? null : (float) $r->serie_start,
                'serie_end' => $r->serie_end === null ? null : (float) $r->serie_end,
                'origin' => $r->origin,
                'attachments_count' => (int) $r->attachments_count,
            ];

            if ($r->type === 'entry') {
                $flush();
                $pendingEntry = ['entry_qty' => (float) $r->quantity, 'supplier' => $r->supplier, 'entry_id' => $r->id, 'source_row' => $r->source_row] + $line;

                continue;
            }

            $line = [
                'bon_number' => $r->bon_number,
                'code' => $r->vehicle_code,
                'matricule' => $r->matricule,
                'odometer' => $r->odometer === null ? null : (float) $r->odometer,
                'exit_qty' => (float) $r->quantity,
            ] + $line;

            if ($pendingEntry && $pendingEntry['source_row'] !== null && $pendingEntry['source_row'] === $r->source_row
                && $pendingEntry['date'] === $r->date && $r->origin === 'import') {
                $line['entry_qty'] = $pendingEntry['entry_qty'];
                $line['supplier'] = $pendingEntry['supplier'];
                $line['entry_id'] = $pendingEntry['entry_id'];
                $line['remark'] = $line['remark'] ?? $pendingEntry['remark'];
                $pendingEntry = null;
            } else {
                $flush();
            }
            $lines[] = $line;
        }
        $flush();

        return array_map(function ($l) {
            unset($l['source_row']);

            return $l;
        }, $lines);
    }
}
