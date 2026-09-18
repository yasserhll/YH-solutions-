<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

class OvertimeMonth extends Model
{
    use HasFactory;

    protected $fillable = [
        'employee_id',
        'site_id',
        'month',
        'carried_hours',
        'declared_hours',
        'total_hours',
        'days_earned',
        'remaining_hours',
    ];

    protected $appends = ['is_paid'];

    protected function casts(): array
    {
        return [
            'month' => 'date',
            'carried_hours' => 'decimal:2',
            'declared_hours' => 'decimal:2',
            'total_hours' => 'decimal:2',
            'remaining_hours' => 'decimal:2',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    /**
     * A month's earned days are paid automatically the moment the calendar
     * moves past that month — no manual action, nothing stored: always
     * computed fresh from `month` vs. today, so it can never go stale.
     * The current month is always "à payer" (still accumulating).
     */
    protected function isPaid(): Attribute
    {
        return Attribute::make(get: fn () => $this->month->lt(Carbon::now()->startOfMonth()));
    }
}
