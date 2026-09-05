<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CashAccount;
use App\Models\CashTransaction;
use App\Services\CashLedgerService;
use Illuminate\Http\Request;

/**
 * `show` is reachable by any authenticated user (see routes/api.php), but its
 * response is shaped by role: a SuperAdmin gets the master account (their
 * real, full balance — never reduced by transfers, see CashLedgerService)
 * plus the summary, which now includes every site's remaining spending
 * limit (`summary.sites`) — while a responsable gets ONLY their own site's
 * derived limit — never the master balance, never other sites.
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

        abort_unless($user->site_id, 403, "Aucun site n'est affecté à cet utilisateur.");

        return [
            'site_id' => $user->site_id,
            'site_balance' => CashTransaction::currentSiteBalance($user->site_id),
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
