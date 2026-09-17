<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CashAccount;
use App\Services\CashLedgerService;
use App\Services\SiteCashPool;
use Illuminate\Http\Request;

/**
 * `show` is reachable by any authenticated user (see routes/api.php), but its
 * response is shaped by role: a SuperAdmin gets the master account (their
 * real, full balance — never reduced by transfers, see CashLedgerService)
 * plus the summary, which includes every site's remaining spending limit
 * (`summary.sites`) — while a responsable gets ONLY the derived limit of
 * each site assigned to them (all of them at once for a multi-site
 * responsable) — never the master balance, never another site's limit. Two
 * of their sites sharing one common caisse (see SiteCashPool) come back as
 * ONE grouped entry, not two identical numbers.
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
            'sites' => SiteCashPool::groupedBalances($user->sites->pluck('id')->all()),
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
