<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Site extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'slug', 'truck_unit'];

    /** Make of the site's camions when none is set on the vehicle: Louta = Sinotruk (hour-metered), the others = MAN (km). */
    public function defaultTruckBrand(): string
    {
        return $this->truck_unit === 'h' ? 'sinotruk' : 'man';
    }

    public function employees(): HasMany
    {
        return $this->hasMany(Employee::class);
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'site_user');
    }

    public function cashAccount(): HasOne
    {
        return $this->hasOne(CashAccount::class);
    }
}
