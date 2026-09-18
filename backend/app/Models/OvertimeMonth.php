<?php

namespace App\Models;

use App\Services\OvertimePayPeriod;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One row per employee per PAYROLL period (27 -> 26, see OvertimePayPeriod)
 * — `month` stores the period's END date (always the 26th of some month),
 * not the 1st of a calendar month.
 */
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
     * A period's earned days are paid automatically the moment the payroll
     * calendar moves past that period (i.e. once we're into a later 27-26
     * window) — no manual action, nothing stored: always computed fresh from
     * `month` (the period's end date) vs. today, so it can never go stale.
     * The current, still-open period is always "à payer".
     */
    protected function isPaid(): Attribute
    {
        return Attribute::make(get: fn () => $this->month->lt(OvertimePayPeriod::endForDate(Carbon::now())));
    }
}
