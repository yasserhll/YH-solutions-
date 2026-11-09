<?php

namespace App\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Suspension extends Model
{
    use HasFactory;

    protected $fillable = [
        'employee_id',
        'site_id',
        'date',
        'reason',
        'description',
        'duration_days',
        'start_date',
        'end_date',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'date' => 'date',
            'start_date' => 'date',
            'end_date' => 'date',
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
     * Neither a Sunday nor a declared holiday (Paramètres → jours fériés)
     * counts as a mise à pied day (user's rule): a suspension "consumes" only
     * the working days actually served, so a 3-day mise à pied starting
     * Friday runs Fri-Sat-Mon, and one more day further if Monday is a
     * holiday. Same skip-and-keep-counting algorithm as
     * Leave::endDateForDuration() (which only skips Sundays).
     */
    public static function endDateForDuration(Carbon $startDate, int $durationDays): Carbon
    {
        $date = $startDate->copy();
        $holidays = array_flip(self::holidayDatesFrom($date));
        $counted = 0;

        while (true) {
            if (! self::isRestDay($date, $holidays)) {
                $counted++;
                if ($counted >= $durationDays) {
                    return $date;
                }
            }
            $date->addDay();
        }
    }

    /**
     * A Sunday or a declared holiday: never a mise à pied day — not counted
     * in its duration, and Pointage keeps the day's normal Sunday/holiday
     * default on it instead of "Absent - Mise à pied".
     *
     * @param  array<string, mixed>  $holidays  holiday dates (Y-m-d) as keys
     */
    public static function isRestDay(Carbon $date, array $holidays): bool
    {
        return $date->isSunday() || isset($holidays[$date->toDateString()]);
    }

    /** @return string[] every declared holiday date (Y-m-d) on or after $from (and up to $to if given) */
    public static function holidayDatesFrom(Carbon|string $from, Carbon|string|null $to = null): array
    {
        return Holiday::query()
            ->whereDate('date', '>=', Carbon::parse($from)->toDateString())
            ->when($to, fn ($q) => $q->whereDate('date', '<=', Carbon::parse($to)->toDateString()))
            ->pluck('date')
            ->map(fn ($d) => Carbon::parse($d)->toDateString())
            ->all();
    }
}
