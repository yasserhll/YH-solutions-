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
     * Sunday never counts as a mise à pied day — same rule, and same
     * skip-and-keep-counting algorithm, as Leave::endDateForDuration(). A
     * suspension "consumes" only the days actually served (Mon-Sat), so a
     * 3-day mise à pied starting Friday runs Fri-Sat-Mon (Sunday skipped,
     * not just excluded from the count-but-still-spanned).
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
}
