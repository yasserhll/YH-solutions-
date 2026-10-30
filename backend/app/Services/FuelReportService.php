<?php

namespace App\Services;

use App\Models\FuelAssignment;
use App\Models\FuelVehicle;
use Illuminate\Support\Facades\DB;

/**
 * Builds one day of the "CONSOMMATION JOURNALIERE DE GASOIL" report for one
 * site — only camions (codes D…) and engins (codes E…), one block per
 * vehicle with one line per refuel of that day:
 * - Litrage / Heure / % come straight from the imported citernes (Heure =
 *   the counter's parcours since the previous refuel, % = consumption / 100,
 *   i.e. L/h shown as a percent — exactly how the hand-made report writes it);
 * - drivers come from the site's affectation (FuelAssignment), unless that
 *   day was edited by hand (FuelReportLine);
 * - Activité is typed per day; when not typed yet, the vehicle's last typed
 *   activité is carried forward, then the affectation's default.
 * Nothing here is stored except the hand edits, so the report always
 * follows the latest import / Global corrections.
 */
class FuelReportService
{
    /** Same "camion or engin" filter everywhere in the report. */
    public const SCOPE_SQL = "(m.vehicle_code LIKE 'D%' OR m.vehicle_code LIKE 'E%')";

    /**
     * $assignedOnly: a site responsable only sees the camions/engins listed in
     * the site's affectation (user's rule); a SuperAdmin sees every D/E code.
     */
    public function build(int $siteId, string $date, bool $assignedOnly = false): array
    {
        $refuels = DB::table('fuel_movements as m')
            ->join('fuel_tanks as t', 't.id', '=', 'm.fuel_tank_id')
            ->join('sites as s', 's.id', '=', 'm.site_id')
            ->leftJoin('fuel_vehicles as v', 'v.code', '=', 'm.vehicle_code')
            ->where('m.site_id', $siteId)
            ->where('m.type', 'exit')
            ->where('m.date', $date)
            ->tap(fn ($q) => $this->scope($q, $siteId, $assignedOnly))
            ->orderBy('m.time')->orderBy('m.id')
            ->get(['m.id', 'm.time', 'm.vehicle_code', 'm.quantity', 'm.odometer', 'm.distance', 'm.consumption', 'm.remark', 't.name as tank', 'v.matricule', 'v.unit', 'v.brand', 's.truck_unit']);

        $codes = $refuels->pluck('vehicle_code')->unique()->values();
        $assignments = FuelAssignment::where('site_id', $siteId)->get()->keyBy('code');
        $lines = DB::table('fuel_report_lines')->where('site_id', $siteId)->where('date', $date)->get()->keyBy('vehicle_code');
        $lastActivities = $this->lastActivities($siteId, $date, $codes->all());

        $vehicles = [];
        foreach ($refuels->groupBy('vehicle_code') as $code => $rows) {
            $assignment = $assignments[$code] ?? null;
            $line = $lines[$code] ?? null;
            $category = $assignment?->category ?? (str_starts_with($code, 'E') ? 'engin' : 'camion');

            $vehicles[] = [
                'code' => $code,
                'label' => $category === 'engin' && $assignment?->label ? $assignment->label : $code,
                'matricule' => $rows->first()->matricule,
                'category' => $category,
                'assigned' => $assignment !== null,
                'sort' => $assignment?->sort_order ?? PHP_INT_MAX,
                'driver_1' => $line ? $line->driver_1 : $assignment?->driver_1,
                'driver_2' => $line ? $line->driver_2 : $assignment?->driver_2,
                'activity' => $line?->activity ?? $lastActivities[$code] ?? $assignment?->activity,
                'edited' => $line !== null,
                'litres' => round($rows->sum('quantity'), 2),
                'refuels' => $rows->map(fn ($r) => $this->refuel($r))->values()->all(),
            ];
        }

        usort($vehicles, fn ($a, $b) => $a['sort'] <=> $b['sort'] ?: strnatcmp($a['code'], $b['code']));
        $camions = array_values(array_filter($vehicles, fn ($v) => $v['category'] === 'camion'));
        $engins = array_values(array_filter($vehicles, fn ($v) => $v['category'] === 'engin'));
        $sum = fn ($list) => round(array_sum(array_column($list, 'litres')), 2);

        return [
            'date' => $date,
            'camions' => $camions,
            'engins' => $engins,
            'totals' => ['camions' => $sum($camions), 'engins' => $sum($engins), 'all' => $sum($vehicles)],
            'prev_date' => $this->neighbourDate($siteId, $date, '<', $assignedOnly),
            'next_date' => $this->neighbourDate($siteId, $date, '>', $assignedOnly),
        ];
    }

    /** Most recent day (on or before today) with a camion/engin refuel, to open the report on. */
    public function latestDate(int $siteId, bool $assignedOnly = false): ?string
    {
        return DB::table('fuel_movements as m')->where('m.site_id', $siteId)->where('m.type', 'exit')
            ->tap(fn ($q) => $this->scope($q, $siteId, $assignedOnly))->where('m.date', '<=', now()->toDateString())->max('m.date');
    }

    /** @return array<int, string> every day of a month (YYYY-MM) that has a report */
    public function datesInMonth(int $siteId, string $month, bool $assignedOnly = false): array
    {
        return DB::table('fuel_movements as m')->where('m.site_id', $siteId)->where('m.type', 'exit')
            ->tap(fn ($q) => $this->scope($q, $siteId, $assignedOnly))
            ->whereBetween('m.date', ["{$month}-01", date('Y-m-t', strtotime("{$month}-01"))])
            ->distinct()->orderBy('m.date')->pluck('m.date')->map(fn ($d) => substr((string) $d, 0, 10))->all();
    }

    protected function refuel(object $r): array
    {
        $unit = FuelVehicle::unitFor($r->vehicle_code, $r->unit, $r->truck_unit, $r->brand);
        $hasParcours = $r->distance !== null && (float) $r->distance > 0;

        return [
            'id' => $r->id,
            'time' => $r->time,
            'quantity' => (float) $r->quantity,
            'tank' => $r->tank,
            'remark' => $r->remark,
            'unit' => $unit,
            'no_counter' => $r->odometer === null,
            // Heure (or km) since the previous refuel.
            'hours' => $hasParcours ? (float) $r->distance : null,
            // The report's "%" column: L/h (or L/100 km) ÷ 100, displayed as a percent.
            'ratio' => $hasParcours && $r->consumption !== null ? round((float) $r->consumption / 100, 4) : null,
        ];
    }

    /** @return array<string, string> code => last activité typed before $date */
    protected function lastActivities(int $siteId, string $date, array $codes): array
    {
        if (! $codes) {
            return [];
        }

        $latest = DB::table('fuel_report_lines')->where('site_id', $siteId)->where('date', '<', $date)
            ->whereIn('vehicle_code', $codes)->whereNotNull('activity')->where('activity', '!=', '')
            ->groupBy('vehicle_code')->select('vehicle_code', DB::raw('MAX(date) as date'));

        return DB::table('fuel_report_lines as l')
            ->joinSub($latest, 'x', fn ($j) => $j->on('x.vehicle_code', '=', 'l.vehicle_code')->on('x.date', '=', 'l.date'))
            ->where('l.site_id', $siteId)
            ->pluck('l.activity', 'l.vehicle_code')->all();
    }

    protected function neighbourDate(int $siteId, string $date, string $operator, bool $assignedOnly = false): ?string
    {
        $query = DB::table('fuel_movements as m')->where('m.site_id', $siteId)->where('m.type', 'exit')
            ->tap(fn ($q) => $this->scope($q, $siteId, $assignedOnly))->where('m.date', $operator, $date);
        $value = $operator === '<' ? $query->max('m.date') : $query->min('m.date');

        return $value ? substr((string) $value, 0, 10) : null;
    }

    /** Camions/engins only — and, for a site responsable, only those in the site's affectation. */
    protected function scope($query, int $siteId, bool $assignedOnly): void
    {
        $query->whereRaw(self::SCOPE_SQL);
        if ($assignedOnly) {
            $query->whereExists(fn ($q) => $q->from('fuel_assignments as a')
                ->whereColumn('a.code', 'm.vehicle_code')->where('a.site_id', $siteId));
        }
    }
}
