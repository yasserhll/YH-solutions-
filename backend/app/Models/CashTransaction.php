<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class CashTransaction extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'cash_account_id',
        'site_id',
        'type',
        'date',
        'beneficiary',
        'description',
        'amount',
        'running_balance',
        'site_running_balance',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'date' => 'date',
            'amount' => 'decimal:2',
            'running_balance' => 'decimal:2',
            'site_running_balance' => 'decimal:2',
        ];
    }

    public function cashAccount(): BelongsTo
    {
        return $this->belongsTo(CashAccount::class);
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * A site's remaining spending limit (not a real pot of money — see
     * CashLedgerService) is derived, never stored independently: it's the
     * site_running_balance of its most recent transfer/expense row, exactly
     * like CashAccount::currentBalance() derives the master balance from the
     * latest running_balance. reorder() guards against the same trap: any
     * future default ordering on this query would otherwise stack with
     * latest() instead of being replaced by it.
     */
    public static function currentSiteBalance(int $siteId): float
    {
        $last = static::query()->reorder()
            ->where('site_id', $siteId)
            ->whereIn('type', ['transfer', 'expense'])
            ->latest('date')
            ->latest('id')
            ->first();

        return $last ? (float) $last->site_running_balance : 0.0;
    }
}
