<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Http\Request;

/**
 * For screens that always work on ONE site at a time, never several mixed
 * (Consommation > Global and Rapport — like the company's own sheets, one
 * per site). A single-site responsable gets theirs automatically; a
 * SuperAdmin or multi-site responsable must pick one via ?site_id= (checked
 * with ensureSiteAccess). Requires InteractsWithSites.
 */
trait ResolvesSingleSite
{
    protected function singleSiteId(Request $request): int
    {
        if ($siteId = (int) $request->input('site_id')) {
            $this->ensureSiteAccess($request, $siteId);

            return $siteId;
        }

        $user = $this->currentUser($request);
        $assigned = $user->assignedSiteIds();
        if (! $user->isSuperAdmin() && count($assigned) === 1) {
            return $assigned[0];
        }

        abort(422, 'Choisissez un site : cet écran se calcule pour un seul site à la fois.');
    }
}
