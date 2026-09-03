<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CashAccount;
use App\Services\CashLedgerService;
use Illuminate\Http\Request;

/**
 * The caisse is a single company-wide account (see CashAccount::singleton) —
 * this whole controller is SuperAdmin-only (see routes/api.php), matching the
 * reference Excel where only the "Admin" sheet carries a solde/reste.
 */
class CashAccountController extends Controller
{
    public function __construct(protected CashLedgerService $ledger) {}

    public function show()
    {
        $account = CashAccount::singleton();

        return [
            ...$account->toArray(),
            'summary' => $this->ledger->summary($account),
        ];
    }

    public function update(Request $request)
    {
        $account = CashAccount::singleton();

        $data = $request->validate([
            'initial_balance' => ['required', 'numeric'],
            'allow_negative_balance' => ['sometimes', 'boolean'],
        ]);

        $account->update($data);
        $this->ledger->recalculate($account);

        return [
            ...$account->fresh()->toArray(),
            'summary' => $this->ledger->summary($account),
        ];
    }
}
