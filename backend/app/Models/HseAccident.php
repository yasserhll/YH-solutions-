<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One accident or incident de travail ("Suivi ATIT"), one line of the
 * company's "BILAN GLOBAL DES ACCIDENTS" workbook.
 */
class HseAccident extends Model
{
    public const TYPES = ['accident', 'incident'];

    public const DECISIONS = ['map', 'repos_maladie', 'licenciement', 'avertissement', 'en_poste', 'autre'];

    /** Decisions that carry a number of days ("MAP - 6 Jours", "Repos Maladie - 14 Jours"). */
    public const DECISIONS_WITH_DAYS = ['map', 'repos_maladie'];

    public const DECISION_LABELS = [
        'map' => 'MAP',
        'repos_maladie' => 'Repos Maladie',
        'licenciement' => 'Licenciement',
        'avertissement' => 'Avertissement',
        'en_poste' => 'En poste',
        'autre' => 'Autre',
    ];

    protected $fillable = [
        'site_id', 'type', 'occurred_on', 'occurred_time', 'shift', 'zone',
        'employee_id', 'driver_name', 'driver_age', 'driver_seniority', 'equipment',
        'description', 'causes', 'decision', 'decision_days', 'decision_note', 'notes', 'created_by',
    ];

    protected $appends = ['decision_label'];

    protected function casts(): array
    {
        return [
            'occurred_on' => 'date:Y-m-d',
            'shift' => 'integer',
            'driver_age' => 'integer',
            'decision_days' => 'integer',
        ];
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class)->withTrashed();
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** "MAP - 6 Jours", "Repos Maladie - 14 Jours", "Licenciement", an "autre" decision's own text… */
    public function getDecisionLabelAttribute(): ?string
    {
        if (! $this->decision) {
            return null;
        }
        if ($this->decision === 'autre') {
            return $this->decision_note ?: 'Autre';
        }
        $label = self::DECISION_LABELS[$this->decision] ?? $this->decision;
        if (in_array($this->decision, self::DECISIONS_WITH_DAYS, true) && $this->decision_days) {
            $label .= ' - '.$this->decision_days.' '.($this->decision_days > 1 ? 'Jours' : 'Jour');
        }

        return $label;
    }

    /** "1 an et 7 mois", "4 mois", "15 jours" between an entry date and the event. */
    public static function seniorityBetween(Carbon|string $from, Carbon|string $to): string
    {
        $from = Carbon::parse($from)->startOfDay();
        $to = Carbon::parse($to)->startOfDay();
        if ($to->lt($from)) {
            return '';
        }
        $diff = $from->diff($to);
        $parts = [];
        if ($diff->y) {
            $parts[] = $diff->y.' '.($diff->y > 1 ? 'ans' : 'an');
        }
        if ($diff->m) {
            $parts[] = $diff->m.' mois';
        }
        if (! $parts) {
            return $diff->d.' '.($diff->d > 1 ? 'jours' : 'jour');
        }

        return implode(' et ', $parts);
    }
}
