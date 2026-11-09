<?php

namespace App\Services;

use App\Models\CashTransaction;
use App\Models\Site;

/**
 * Every site has its OWN caisse (its own spending limit, see
 * CashLedgerService) — two sites are never pooled, whoever manages them.
 * "Caisse fusionnée" (`users.cash_merged`, ticked by a SuperAdmin in
 * Utilisateurs) only changes what that one account SEES: its sites' limits
 * shown as one combined card. Each expense still debits the site it was
 * declared for, and is refused when that site's own limit is too low.
 */
class SiteCashBalances
{
    /**
     * One entry per site, or — when $merged and there are several sites —
     * a single entry with the sites' limits added up and their names joined.
     *
     * @return array<int, array{site_id: int, site_ids: int[], site_name: string, balance: float}>
     */
    public static function forSites(array $siteIds, bool $merged = false): array
    {
        $entries = Site::whereIn('id', $siteIds)->orderBy('name')->get(['id', 'name'])
            ->map(fn (Site $site) => [
                'site_id' => $site->id,
                'site_ids' => [$site->id],
                'site_name' => $site->name,
                'balance' => CashTransaction::currentSiteBalance($site->id),
            ])->all();

        if (! $merged || count($entries) < 2) {
            return $entries;
        }

        return [[
            'site_id' => $entries[0]['site_id'],
            'site_ids' => array_column($entries, 'site_id'),
            'site_name' => implode(' + ', array_column($entries, 'site_name')),
            'balance' => round(array_sum(array_column($entries, 'balance')), 2),
        ]];
    }
}
