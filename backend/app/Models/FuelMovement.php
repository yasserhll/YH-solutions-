<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line of a citerne sheet — an ENTREE (delivery into the tank) or a
 * SORTIE (fuel given to a vehicle). Mostly written by FuelImportService (a
 * re-import replaces the tank's IMPORTED rows wholesale), but a SORTIE can
 * also be added/edited/deleted by hand from the Global — see
 * FuelMovementController and FuelMovementOverride for how those survive a
 * re-import. previous_odometer/distance/consumption are always derived by
 * FuelConsumptionService, never typed.
 */
class FuelMovement extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    /**
     * Stable identity of an imported row: its original Excel values, plus
     * an occurrence number so two identical lines stay distinct. Survives
     * lines being inserted/removed above it (unlike source_row); changes
     * when the line itself is corrected in Excel — the file then wins.
     *
     * @param  array<string, int>  $seen  occurrence counters, shared across one tank's rows
     */
    public static function fingerprint(array $row, array &$seen): string
    {
        $number = fn ($v) => $v === null || $v === '' ? '' : number_format((float) $v, 2, '.', '');
        $base = implode('|', [
            $row['type'], substr((string) $row['date'], 0, 10), (string) ($row['time'] ?? ''),
            (string) ($row['vehicle_code'] ?? ''), $number($row['quantity']), $number($row['odometer'] ?? null),
        ]);
        $seen[$base] = ($seen[$base] ?? 0) + 1;

        return sha1($base.'#'.$seen[$base]);
    }

    protected function casts(): array
    {
        return [
            'date' => 'date:Y-m-d',
            'quantity' => 'float',
            'odometer' => 'float',
            'previous_odometer' => 'float',
            'distance' => 'float',
            'consumption' => 'float',
            'serie_start' => 'float',
            'serie_end' => 'float',
            'edited' => 'boolean',
        ];
    }

    public function tank(): BelongsTo
    {
        return $this->belongsTo(FuelTank::class, 'fuel_tank_id');
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }
}
