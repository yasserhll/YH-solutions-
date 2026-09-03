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
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'date' => 'date',
            'amount' => 'decimal:2',
            'running_balance' => 'decimal:2',
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
}
