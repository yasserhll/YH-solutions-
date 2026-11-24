<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Days of congé an employee took in one calendar month, from the old
 * "ETAT DE CONGE" workbooks (no exact dates there, only a count per month).
 */
class LeaveHistory extends Model
{
    protected $table = 'leave_history';

    protected $guarded = [];

    /** Right acquired per month of seniority, as in the workbooks (F × 1.5). */
    public const DAYS_PER_MONTH = 1.5;

    protected function casts(): array
    {
        return ['days' => 'float', 'year' => 'integer', 'month' => 'integer'];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }
}
