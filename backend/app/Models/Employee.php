<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Employee extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'full_name',
        'site_id',
        'department_id',
        'position_id',
        'establishment',
        'entry_date',
        'exit_date',
        'status',
        'phone',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'entry_date' => 'date',
            'exit_date' => 'date',
        ];
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(Position::class);
    }

    public function attendances(): HasMany
    {
        return $this->hasMany(Attendance::class);
    }

    public function leaveRequests(): HasMany
    {
        return $this->hasMany(LeaveRequest::class);
    }

    public function leaves(): HasMany
    {
        return $this->hasMany(Leave::class);
    }

    public function disciplinaryWarnings(): HasMany
    {
        return $this->hasMany(DisciplinaryWarning::class);
    }

    public function suspensions(): HasMany
    {
        return $this->hasMany(Suspension::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(Assignment::class);
    }

    public function currentAssignment()
    {
        return $this->hasOne(Assignment::class)->where('is_current', true)->latestOfMany('start_date');
    }
}
