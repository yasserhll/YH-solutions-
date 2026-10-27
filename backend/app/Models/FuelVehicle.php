<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * "Matriculation": maps the short code keyed in at the pump (E81, D240,
 * 85751...) to its full registration / designation. Company-wide, not
 * site-scoped — the same engine can be refuelled from any site's citerne.
 */
class FuelVehicle extends Model
{
    protected $fillable = ['code', 'matricule', 'type', 'unit'];

    /**
     * Same normalization for every code, whether it comes from an import or
     * a form — "85751", 85751 and 85751.0 must all match the same vehicle.
     */
    public static function normalizeCode(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (is_float($value) || is_int($value)) {
            $value = floor((float) $value) == (float) $value ? (string) (int) $value : (string) $value;
        }
        $code = strtoupper(trim(preg_replace('/\s+/', ' ', (string) $value)));

        if (preg_match('/^\d+\.0+$/', $code)) {
            $code = (string) (int) $code;
        }

        return $code === '' ? null : $code;
    }

    /**
     * Default counter unit from the code: a numeric plate prefix (85751...)
     * is a km odometer (L/100 km); everything else — D camions, E engins,
     * CADEX N04... — is an hour meter (L/h), as in the company's daily report.
     * A vehicle's own `unit` (Matriculation) overrides it, e.g. the D77 water
     * truck runs on a km odometer.
     */
    public static function unitFor(?string $code, ?string $override = null): string
    {
        if ($override === 'km' || $override === 'h') {
            return $override;
        }

        return $code !== null && ctype_digit($code) ? 'km' : 'h';
    }

    /** SQL twin of unitFor() === 'km', for aggregates (needs fuel_vehicles joined as `v`). */
    public const KM_SQL = "(COALESCE(v.unit, IF(fuel_movements.vehicle_code REGEXP '^[0-9]+$', 'km', 'h')) = 'km')";
}
