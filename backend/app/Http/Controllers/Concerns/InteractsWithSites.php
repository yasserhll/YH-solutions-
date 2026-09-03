<?php

namespace App\Http\Controllers\Concerns;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Centralises the site-scoping rule that must never be trusted to the frontend:
 * a "responsable" only ever sees/writes their own site, no matter what the
 * request body or query string claims.
 */
trait InteractsWithSites
{
    protected function currentUser(Request $request): User
    {
        return $request->user();
    }

    /**
     * The site id to use for a new record. A responsable is always forced onto
     * their own site; a superadmin must explicitly provide one.
     */
    protected function resolveSiteId(Request $request): int
    {
        $user = $this->currentUser($request);

        if (! $user->isSuperAdmin()) {
            if (! $user->site_id) {
                throw new HttpException(403, "Aucun site n'est affecté à cet utilisateur.");
            }

            return $user->site_id;
        }

        $siteId = (int) $request->input('site_id');

        if (! $siteId) {
            throw new HttpException(422, 'Le site est obligatoire.');
        }

        return $siteId;
    }

    /**
     * Aborts if the given site does not belong to the current user.
     */
    protected function ensureSiteAccess(Request $request, int $siteId): void
    {
        $user = $this->currentUser($request);

        if (! $user->canAccessSite($siteId)) {
            throw new HttpException(403, "Vous n'avez pas accès à ce site.");
        }
    }

    /**
     * Applies the site filter to a query: forced to the user's own site for a
     * responsable, optional ?site_id= filter for a superadmin.
     */
    protected function scopeToSite(Builder $query, Request $request, string $column = 'site_id'): Builder
    {
        $user = $this->currentUser($request);

        if (! $user->isSuperAdmin()) {
            return $query->where($column, $user->site_id);
        }

        if ($siteId = $request->query('site_id')) {
            $query->where($column, $siteId);
        }

        return $query;
    }
}
