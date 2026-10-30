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
    protected $fillable = ['code', 'matricule', 'type', 'brand', 'unit'];

    /** Counter unit of each camion make: Sinotruk is hour-metered like the engins, MAN / Renault run on km. */
    public const BRAND_UNITS = ['sinotruk' => 'h', 'man' => 'km', 'renault' => 'km'];

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
     * Counter unit, first match wins:
     * 1. the vehicle's own `unit` (Matriculation "Compteur"), e.g. the D77
     *    water truck runs on a km odometer;
     * 2. a camion's make (`brand`, see BRAND_UNITS): Sinotruk = heures,
     *    MAN / Renault = km — never for an engin (E…), always in hours;
     * 3. a numeric plate prefix (85751...) is a km odometer (L/100 km);
     * 4. a D camion without a marque follows its site's default make
     *    (`sites.truck_unit`: Louta = Sinotruk, the other sites = MAN);
     * 5. everything else — E engins, CADEX N04... — is an hour meter (L/h).
     */
    public static function unitFor(?string $code, ?string $override = null, ?string $siteTruckUnit = null, ?string $brand = null): string
    {
        if ($override === 'km' || $override === 'h') {
            return $override;
        }
        if ($brand !== null && isset(self::BRAND_UNITS[$brand]) && ! str_starts_with((string) $code, 'E')) {
            return self::BRAND_UNITS[$brand];
        }
        if ($code !== null && ctype_digit($code)) {
            return 'km';
        }
        if ($code !== null && str_starts_with($code, 'D') && ($siteTruckUnit === 'km' || $siteTruckUnit === 'h')) {
            return $siteTruckUnit;
        }

        return 'h';
    }

    /** SQL twin of unitFor() === 'km', for aggregates (needs fuel_vehicles joined as `v` and sites as `s`). */
    public const KM_SQL = "(COALESCE(v.unit, CASE WHEN fuel_movements.vehicle_code LIKE 'E%' THEN NULL WHEN v.brand = 'sinotruk' THEN 'h' WHEN v.brand IN ('man', 'renault') THEN 'km' END, CASE WHEN fuel_movements.vehicle_code REGEXP '^[0-9]+$' THEN 'km' WHEN fuel_movements.vehicle_code LIKE 'D%' THEN s.truck_unit ELSE 'h' END) = 'km')";
}
