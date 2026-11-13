<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A proof attached to a bon carburant (photo of the paper bon, of the
 * pump index, a PDF…). The file lives on the private `local` disk and is
 * only served through FuelBonController (site-checked), never publicly.
 */
class FuelBonAttachment extends Model
{
    protected $fillable = ['fuel_movement_id', 'path', 'original_name', 'mime', 'size', 'uploaded_by'];

    protected $hidden = ['path'];

    public function movement(): BelongsTo
    {
        return $this->belongsTo(FuelMovement::class, 'fuel_movement_id');
    }
}
