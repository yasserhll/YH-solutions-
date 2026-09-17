<?php

namespace App\Services;

use App\Models\Site;
use Illuminate\Support\Facades\DB;

/**
 * Two or more sites managed by the SAME responsable share ONE common caisse
 * balance rather than each having its own — e.g. a responsable assigned to
 * both Bouchane and Mzinda has a single pooled spending limit covering
 * purchases declared against either site, not two separate 500 DH limits.
 * A site worked by only a single-site responsable (or by no responsable yet)
 * is its own pool of one, which is the classic (pre-pooling) behavior.
 *
 * The pool is derived from the `site_user` pivot (which sites are jointly
 * assigned to which responsable), NOT stored — resolved fresh via a
 * union-find over every responsable's assigned sites. A SuperAdmin has no
 * site_user rows and is irrelevant to pooling: this only groups sites that
 * share a RESPONSABLE, never affects a SuperAdmin's unrestricted access.
 */
class SiteCashPool
{
    /**
     * Every site id sharing a common caisse with $siteId (includes $siteId
     * itself). A site with no responsable, or one covered only by a
     * single-site responsable, returns [$siteId] alone.
     */
    public static function forSite(int $siteId): array
    {
        return static::pools()[$siteId] ?? [$siteId];
    }

    /**
     * Collapses a list of site ids into one entry per shared pool, each with
     * that pool's current balance — used wherever a per-site balance is
     * displayed (CashAccountController, DashboardController, the SuperAdmin
     * summary) so two pooled sites show ONE combined line, never the same
     * money counted twice under two different site names.
     *
     * @return array<int, array{site_id: int, site_ids: int[], site_name: string, balance: float}>
     */
    public static function groupedBalances(array $siteIds): array
    {
        $seenPoolKeys = [];
        $result = [];

        foreach ($siteIds as $siteId) {
            $poolIds = static::forSite($siteId);
            sort($poolIds);
            $poolKey = implode(',', $poolIds);

            if (isset($seenPoolKeys[$poolKey])) {
                continue;
            }
            $seenPoolKeys[$poolKey] = true;

            $names = Site::whereIn('id', $poolIds)->orderBy('name')->pluck('name');

            $result[] = [
                'site_id' => $poolIds[0],
                'site_ids' => $poolIds,
                'site_name' => $names->implode(' + '),
                'balance' => \App\Models\CashTransaction::currentSiteBalance($siteId),
            ];
        }

        return $result;
    }

    /**
     * site_id => [every site id in its pool], for every site that has at
     * least one responsable. Computed fresh each call — cheap given this
     * app's handful of sites, so no need to cache across requests.
     */
    protected static function pools(): array
    {
        $parent = [];

        $find = function (int $x) use (&$parent, &$find): int {
            if (! isset($parent[$x])) {
                $parent[$x] = $x;
            }
            while ($parent[$x] !== $x) {
                $parent[$x] = $parent[$parent[$x]];
                $x = $parent[$x];
            }

            return $x;
        };

        $union = function (int $a, int $b) use (&$parent, $find): void {
            $rootA = $find($a);
            $rootB = $find($b);
            if ($rootA !== $rootB) {
                $parent[$rootA] = $rootB;
            }
        };

        $allSiteIds = Site::pluck('id')->all();
        foreach ($allSiteIds as $id) {
            $find($id);
        }

        $byResponsable = DB::table('site_user')
            ->join('users', 'users.id', '=', 'site_user.user_id')
            ->where('users.role', 'responsable')
            ->select('site_user.user_id', 'site_user.site_id')
            ->get()
            ->groupBy('user_id');

        foreach ($byResponsable as $rows) {
            $ids = $rows->pluck('site_id')->all();
            for ($i = 1; $i < count($ids); $i++) {
                $union($ids[0], $ids[$i]);
            }
        }

        $groups = [];
        foreach ($allSiteIds as $id) {
            $groups[$find($id)][] = $id;
        }

        $result = [];
        foreach ($groups as $group) {
            foreach ($group as $id) {
                $result[$id] = $group;
            }
        }

        return $result;
    }
}
