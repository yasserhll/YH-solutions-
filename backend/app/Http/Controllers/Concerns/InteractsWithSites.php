<?php

namespace App\Http\Controllers\Concerns;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Centralises the site-scoping rule that must never be trusted to the frontend:
 * a "responsable" only ever sees/writes sites assigned to them (User::assignedSiteIds),
 * no matter what the request body or query string claims. A multi-site
 * responsable's sites are all usable at once — this is the same shape a
 * SuperAdmin already gets, just restricted to a subset of sites instead of
 * every site.
 */
trait InteractsWithSites
{
    protected function currentUser(Request $request): User
    {
        return $request->user();
    }

    /**
     * The site id to use for a new record. A single-site responsable is
     * always forced onto their one site; a multi-site responsable (or a
     * superadmin) must explicitly supply one, and it must be one of their
     * assigned sites.
     */
    protected function resolveSiteId(Request $request): int
    {
        $user = $this->currentUser($request);
        $assignedSiteIds = $user->assignedSiteIds();

        if (! $user->isSuperAdmin() && count($assignedSiteIds) === 1) {
            return $assignedSiteIds[0];
        }

        $siteId = (int) $request->input('site_id');

        if (! $siteId) {
            throw new HttpException(422, 'Le site est obligatoire.');
        }

        $this->ensureSiteAccess($request, $siteId);

        return $siteId;
    }

    /**
     * Aborts if the given site is not one of the current user's assigned
     * sites (always passes for a superadmin).
     */
    protected function ensureSiteAccess(Request $request, int $siteId): void
    {
        $user = $this->currentUser($request);

        if (! $user->canAccessSite($siteId)) {
            throw new HttpException(403, "Vous n'avez pas accès à ce site.");
        }
    }

    /**
     * Applies the site filter to a query: restricted to every site assigned
     * to a responsable (aggregated, not just one), with an optional
     * `?site_id=` narrowing it further to one of those sites; a superadmin's
     * optional `?site_id=` filter is unrestricted, same as before.
     */
    protected function scopeToSite(Builder $query, Request $request, string $column = 'site_id'): Builder
    {
        $user = $this->currentUser($request);

        if (! $user->isSuperAdmin()) {
            $query->whereIn($column, $user->assignedSiteIds());
        }

        if ($siteId = $request->query('site_id')) {
            $this->ensureSiteAccess($request, (int) $siteId);
            $query->where($column, $siteId);
        }

        return $query;
    }
}
