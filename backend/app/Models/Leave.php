<?php

namespace App\Models;

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
}
