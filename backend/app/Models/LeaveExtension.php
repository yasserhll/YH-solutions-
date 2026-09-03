<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LeaveExtension extends Model
{
    use HasFactory;

    protected $fillable = [
        'leave_id',
        'extra_days',
        'reason',
        'previous_end_date',
        'new_end_date',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'previous_end_date' => 'date',
            'new_end_date' => 'date',
        ];
    }

    public function leave(): BelongsTo
    {
        return $this->belongsTo(Leave::class);
    }
}
