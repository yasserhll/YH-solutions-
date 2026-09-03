<?php

namespace App\Models;

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
}
