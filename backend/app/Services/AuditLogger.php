<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;

/**
 * The write side of the "Historique" page (Paramètres → Historique). Every
 * mutating controller calls this right after the mutation succeeds, passing
 * a ready-to-display French sentence rather than raw field diffs — the
 * Historique page is meant to read like a plain activity feed ("Ahmed
 * Benali marqué absent (Maladie) — Louta"), not force the viewer to decode
 * old_values/new_values themselves. $siteId is stored directly on the row
 * (not inferred via a join at read time) so AuditLogController can scope a
 * responsable's view to their own site(s) the same way every other
 * site-scoped list in this app does.
 */
class AuditLogger
{
    public static function log(string $action, string $description, ?int $siteId, ?Model $model = null, ?array $oldValues = null, ?array $newValues = null): void
    {
        AuditLog::create([
            'user_id' => Auth::id(),
            'site_id' => $siteId,
            'action' => $action,
            'description' => $description,
            'auditable_type' => $model?->getMorphClass(),
            'auditable_id' => $model?->getKey(),
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'created_at' => now(),
        ]);
    }
}
