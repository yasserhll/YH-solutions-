<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\Request;

/**
 * The read side of "Historique" (Paramètres → Historique) — a plain,
 * site-scoped activity feed of every mutating action AuditLogger::log() was
 * called for (pointage marqué/annulé, congés saisis/modifiés/supprimés,
 * sanctions, affectations, mouvements, caisse...). A responsable only ever
 * sees their own site(s)' rows, same as everywhere else in the app; a
 * SuperAdmin sees everything, filterable to one site via the usual
 * `?site_id=`. `action` groups rows by module (e.g. `attendance.*`,
 * `leave.*`) so the frontend's filter dropdown doesn't need its own
 * hardcoded list — it's derived from `groups()` below.
 */
class AuditLogController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = AuditLog::with(['user', 'site']);
        $this->scopeToSite($query, $request);

        if ($from = $request->query('date_from')) {
            $query->whereDate('created_at', '>=', $from);
        }
        if ($to = $request->query('date_to')) {
            $query->whereDate('created_at', '<=', $to);
        }
        if ($module = $request->query('module')) {
            $query->where('action', 'like', "{$module}.%");
        }
        if ($search = $request->query('search')) {
            $query->where('description', 'like', "%{$search}%");
        }

        return $query->orderByDesc('created_at')->orderByDesc('id')->paginate($request->integer('per_page', 30));
    }
}
