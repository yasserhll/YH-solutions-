<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HseReport extends Model
{
    use HasFactory;

    protected $fillable = [
        'site_id',
        'report_date',
        'activities',
        'spa_count',
        'topics_covered',
        'participants_count',
        'sanctions_count',
        'dangerous_situations_count',
        'equipment_inspected',
        'general_state',
        'sor_notes',
        'corrective_actions',
        'incidents_count',
        'incidents_comment',
        'accidents_count',
        'accidents_comment',
        'environmental_impact_count',
        'environmental_impact_comment',
        'shift_headcount',
        'hours_worked',
        'sensitization_participation_rate',
        'corrective_actions_closure_rate',
        'non_conformities_count',
        'inductions_count',
        'audits_count',
        'evacuation_drills_count',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'report_date' => 'date',
            'hours_worked' => 'decimal:2',
            'sensitization_participation_rate' => 'decimal:2',
            'corrective_actions_closure_rate' => 'decimal:2',
        ];
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
