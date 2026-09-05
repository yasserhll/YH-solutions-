<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Singleton: exactly one row, representing the master/common caisse (the
 * reference Excel's "Admin" sheet). A site's own balance is NOT a row here —
 * it's derived from cash_transactions.site_running_balance, see
 * CashTransaction::currentSiteBalance().
 */
class CashAccount extends Model
{
    use HasFactory;

    protected $fillable = [
        'initial_balance',
        'allow_negative_balance',
    ];

    protected function casts(): array
    {
        return [
            'initial_balance' => 'decimal:2',
            'allow_negative_balance' => 'boolean',
        ];
    }

    public static function singleton(): self
    {
        return static::query()->firstOrCreate([]);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(CashTransaction::class)->orderBy('date')->orderBy('id');
    }

    public function currentBalance(): float
    {
        // reorder() first: the relation's own orderBy('date')->orderBy('id')
        // (ascending) would otherwise stack with latest()'s descending order
        // instead of being replaced by it, silently picking the earliest
        // transaction instead of the most recent one.
        $last = $this->transactions()->reorder()->latest('date')->latest('id')->first();

        return $last ? (float) $last->running_balance : (float) $this->initial_balance;
    }
}
