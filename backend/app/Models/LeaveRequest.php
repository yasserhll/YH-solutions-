<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class LeaveRequest extends Model
{
    use HasFactory;

    protected $fillable = [
        'employee_id',
        'site_id',
        'request_date',
        'desired_start_date',
        'duration_days',
        'reason',
        'status',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'request_date' => 'date',
            'desired_start_date' => 'date',
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

    public function leave(): HasOne
    {
        return $this->hasOne(Leave::class);
    }
}
