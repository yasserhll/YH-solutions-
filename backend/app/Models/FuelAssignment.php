<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line of a site's "LISTE D'AFFECTATION": the camion/engin (canonical
 * code E49, D140 — `label` keeps how the sheet writes it, "480-E49") and its
 * équipe 1 / équipe 2 drivers. Feeds the daily Rapport; site-scoped.
 */
class FuelAssignment extends Model
{
    protected $fillable = ['site_id', 'code', 'label', 'category', 'driver_1', 'driver_2', 'replacements', 'activity', 'sort_order'];

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    /**
     * The canonical code inside a label as written in the sheets:
     * "480-E49" -> E49, "D10-E89" -> E89 (a Cat D10 bulldozer is engin E89),
     * "D66 ARR" -> D66, "BULL-E73" -> E73. An engin code wins over a D-model.
     */
    public static function codeFromLabel(mixed $value): ?string
    {
        $text = strtoupper(trim((string) $value));
        if (preg_match('/(?<![A-Z0-9])E\d+(?![0-9])/', $text, $m) || preg_match('/(?<![A-Z0-9])D\d+(?![0-9])/', $text, $m)) {
            return $m[0];
        }

        return null;
    }
}
