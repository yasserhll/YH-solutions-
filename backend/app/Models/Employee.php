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
        'matricule',
        'site_id',
        'department_id',
        'position_id',
        'establishment',
        'entry_date',
        'exit_date',
        'status',
        'phone',
        'notes',
        'cin_expiry_date',
        'is_driver',
        'license_expiry_date',
        'driver_opt_out',
    ];

    /**
     * A CIN / permis date typed or corrected (or the person leaving) sends
     * its device alert right after the response — no delay, like contracts.
     */
    protected static function booted(): void
    {
        static::saved(function (Employee $employee) {
            if ($employee->wasChanged(['cin_expiry_date', 'license_expiry_date', 'status']) || $employee->wasRecentlyCreated) {
                if ($employee->cin_expiry_date || $employee->license_expiry_date) {
                    \App\Services\ContractAlerts::soon();
                }
            }
        });
    }

    protected function casts(): array
    {
        return [
            'entry_date' => 'date',
            'exit_date' => 'date',
            'cin_expiry_date' => 'date:Y-m-d',
            'is_driver' => 'boolean',
            'license_expiry_date' => 'date:Y-m-d',
            'driver_opt_out' => 'boolean',
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

    public function illnesses(): HasMany
    {
        return $this->hasMany(Illness::class);
    }

    public function overtimeEntries(): HasMany
    {
        return $this->hasMany(OvertimeEntry::class);
    }

    public function overtimeMonths(): HasMany
    {
        return $this->hasMany(OvertimeMonth::class);
    }

    public function entries(): HasMany
    {
        return $this->hasMany(Entry::class);
    }

    public function exits(): HasMany
    {
        return $this->hasMany(EmployeeExit::class);
    }

    public function currentAssignment()
    {
        return $this->hasOne(Assignment::class)->where('is_current', true)->latestOfMany('start_date');
    }
}
