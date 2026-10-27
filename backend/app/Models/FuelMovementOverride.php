<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A hand correction made from the Global on an IMPORTED row (edit or
 * delete), remembered by the row's fingerprint so FuelImportService can
 * re-apply it after the citerne's Excel file is re-imported — otherwise the
 * next import would silently undo it.
 */
class FuelMovementOverride extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['data' => 'array'];
    }
}
