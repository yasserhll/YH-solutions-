<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A file of a delivery: the bon de livraison photo ('bl') or the invoice
 * ('facture'). Private `local` disk, served only through
 * FuelDeliveryController after a site check.
 */
class FuelDeliveryAttachment extends Model
{
    protected $fillable = ['fuel_delivery_id', 'kind', 'path', 'original_name', 'mime', 'size', 'uploaded_by'];

    protected $hidden = ['path'];

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(FuelDelivery::class, 'fuel_delivery_id');
    }
}
