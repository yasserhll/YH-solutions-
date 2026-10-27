<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * What was typed by hand for one vehicle on one day of the Rapport (a
 * replacement driver, the day's activité). Everything else in the report is
 * computed from the imported citernes, so it is never stored.
 */
class FuelReportLine extends Model
{
    protected $fillable = ['site_id', 'date', 'vehicle_code', 'driver_1', 'driver_2', 'activity', 'updated_by'];

    protected function casts(): array
    {
        return ['date' => 'date:Y-m-d'];
    }
}
