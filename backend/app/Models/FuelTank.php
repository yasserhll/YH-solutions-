<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FuelTank extends Model
{
    protected $fillable = ['site_id', 'name', 'last_import_file', 'last_imported_at', 'last_imported_by'];

    protected function casts(): array
    {
        return ['last_imported_at' => 'datetime'];
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    public function importer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'last_imported_by');
    }

    public function movements(): HasMany
    {
        return $this->hasMany(FuelMovement::class);
    }
}
