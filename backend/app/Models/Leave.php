<?php

namespace App\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Leave extends Model
{
    use HasFactory;

    protected $fillable = [
        'employee_id',
        'site_id',
        'leave_request_id',
        'start_date',
        'duration_days',
        'end_date',
        'reason',
        'status',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'start_date' => 'date',
            'end_date' => 'date',
        ];
    }

    /**
     * Computed, never trusted from the stored column — a leave becomes
     * "termine" the instant its end_date has fully passed, with no manual
     * action needed (same "computed, never stored" reasoning as
     * OvertimeMonth::isPaid()). The raw `status` DB column is legacy and
     * ignored here on purpose.
     */
    protected function status(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->isFinished() ? 'termine' : 'en_cours',
        );
    }

    public function isFinished(): bool
    {
        return $this->end_date !== null && $this->end_date->lt(Carbon::today());
    }

    public function scopeInProgress($query)
    {
        return $query->whereDate('end_date', '>=', Carbon::today());
    }

    public function scopeFinished($query)
    {
        return $query->whereDate('end_date', '<', Carbon::today());
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    public function leaveRequest(): BelongsTo
    {
        return $this->belongsTo(LeaveRequest::class);
    }

    public function extensions(): HasMany
    {
        return $this->hasMany(LeaveExtension::class);
    }

    /**
     * Sundays don't count as leave days — a leave "consumes" only the days
     * actually taken off (Mon-Sat), so the end date must skip over them
     * rather than counting 7 calendar days per week.
     */
    public static function endDateForDuration(Carbon $startDate, int $durationDays): Carbon
    {
        $date = $startDate->copy();
        $counted = 0;

        while (true) {
            if (! $date->isSunday()) {
                $counted++;
                if ($counted === $durationDays) {
                    return $date;
                }
            }
            $date->addDay();
        }
    }

    public static function extendEndDate(Carbon $previousEndDate, int $extraDays): Carbon
    {
        return self::endDateForDuration($previousEndDate->copy()->addDay(), $extraDays);
    }
}
