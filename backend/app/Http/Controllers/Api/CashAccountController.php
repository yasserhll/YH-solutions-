<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CashAccount;
use App\Services\CashLedgerService;
use App\Services\SiteCashBalances;
use Illuminate\Http\Request;

/**
 * `show` is reachable by any authenticated user (see routes/api.php), but its
 * response is shaped by role: a SuperAdmin gets the master account (their
 * real, full balance — never reduced by transfers, see CashLedgerService)
 * plus the summary, which includes every site's remaining spending limit
 * (`summary.sites`) — while a responsable gets ONLY the derived limit of
 * each site assigned to them (all of them at once for a multi-site
 * responsable) — never the master balance, never another site's limit. An
 * account a SuperAdmin set to "caisse fusionnée" gets its sites as ONE
 * combined entry instead (see SiteCashBalances).
 * `update` (editing initial_balance) stays SuperAdmin-only, per routes/api.php.
 */
class CashAccountController extends Controller
{
    public function __construct(protected CashLedgerService $ledger) {}

    public function show(Request $request)
    {
        $user = $request->user();

        if ($user->isSuperAdmin()) {
            $account = CashAccount::singleton();

            return [
                ...$account->toArray(),
                'summary' => $this->ledger->summary($account),
            ];
        }

        return [
            'sites' => SiteCashBalances::forSites($user->sites->pluck('id')->all(), $user->cash_merged),
        ];
    }

    public function update(Request $request)
    {
        $account = CashAccount::singleton();

        $data = $request->validate([
            'initial_balance' => ['required', 'numeric'],
        ]);

        $account->update($data);
        $this->ledger->recalculate($account);

        return [
            ...$account->fresh()->toArray(),
            'summary' => $this->ledger->summary($account),
        ];
    }
}
