<?php

namespace App\Services;

use App\Models\CashAccount;
use App\Models\CashTransaction;
use App\Models\Site;
use Illuminate\Support\Facades\DB;

/**
 * Two ledgers derived from one ordered pass over cash_transactions:
 *
 * - running_balance: the master/common caisse's real balance, moved only by
 *   `entry` (+, an outside recharge) and `expense` (-, a site's declared
 *   purchase — this is real money actually leaving the company).
 * - site_running_balance: a site's own remaining SPENDING LIMIT (not a
 *   separate pot of real money), moved only by `transfer` (+, the admin
 *   raises the site's limit) and `expense` (-, consumes it). Null for
 *   `entry` rows.
 *
 * A `transfer` is deliberately NOT a real money movement: it never touches
 * `running_balance`. Giving Ben Guerir a 2000 DH limit does not remove
 * 2000 DH from the admin's 12000 DH — it only caps what that site's
 * responsable is allowed to declare. The only thing that actually spends
 * real money is `expense`, which is why it debits BOTH ledgers at once:
 * the admin's true balance (real money spent) AND the site's remaining
 * limit (how much of its allowance is left). Example: admin=12000,
 * transfer 2000 to Ben Guerir -> admin still 12000, Ben Guerir limit=2000;
 * Ben Guerir declares a 500 DH expense -> admin=11500, Ben Guerir limit=1500.
 *
 * Because a transaction can be edited/inserted anywhere in the timeline,
 * every write recalculates both running balances for the account's full
 * history, not just from the changed record forward.
 *
 * A declared expense IS blocked (422) against its own site's remaining
 * limit — this is a deliberate exception to the rule below, which still
 * applies to the master ledger: an entry or an expense is never blocked
 * for exceeding the master's current balance (same "never block a real
 * purchase" philosophy as before this feature), and a transfer is never
 * blocked either (it isn't a real money movement, just raising a limit).
 */
class CashLedgerService
{
    public function create(CashAccount $account, array $data): CashTransaction
    {
        return DB::transaction(function () use ($account, $data) {
            $data['running_balance'] = 0;
            $data['site_running_balance'] = null;
            $transaction = $account->transactions()->create($data);

            $this->recalculate($account);

            return $transaction->fresh();
        });
    }

    public function update(CashTransaction $transaction, array $data): CashTransaction
    {
        return DB::transaction(function () use ($transaction, $data) {
            $account = $transaction->cashAccount;
            $transaction->fill($data)->save();
            $this->recalculate($account);

            return $transaction->fresh();
        });
    }

    public function delete(CashTransaction $transaction): void
    {
        DB::transaction(function () use ($transaction) {
            $account = $transaction->cashAccount;
            $transaction->delete();
            $this->recalculate($account);
        });
    }

    public function recalculate(CashAccount $account): void
    {
        $masterBalance = (string) $account->initial_balance;
        $siteLimits = [];

        $account->transactions()
            ->orderBy('date')
            ->orderBy('id')
            ->each(function (CashTransaction $transaction) use (&$masterBalance, &$siteLimits) {
                $siteLimit = null;

                switch ($transaction->type) {
                    case 'entry':
                        $masterBalance = bcadd($masterBalance, (string) $transaction->amount, 2);
                        break;

                    case 'transfer':
                        // Raises the site's spending limit only — not a real
                        // money movement, the master balance is untouched.
                        $siteId = $transaction->site_id;
                        $siteLimits[$siteId] = bcadd($siteLimits[$siteId] ?? '0.00', (string) $transaction->amount, 2);
                        $siteLimit = $siteLimits[$siteId];
                        break;

                    case 'expense':
                        // Real money spent: debits both the master balance
                        // and the declaring site's remaining limit.
                        $masterBalance = bcsub($masterBalance, (string) $transaction->amount, 2);
                        $siteId = $transaction->site_id;
                        $siteLimits[$siteId] = bcsub($siteLimits[$siteId] ?? '0.00', (string) $transaction->amount, 2);
                        $siteLimit = $siteLimits[$siteId];
                        break;
                }

                $transaction->updateQuietly([
                    'running_balance' => $masterBalance,
                    'site_running_balance' => $siteLimit,
                ]);
            });
    }

    public function summary(CashAccount $account): array
    {
        $totalEntries = (float) $account->transactions()->where('type', 'entry')->sum('amount');
        $totalExpenses = (float) $account->transactions()->where('type', 'expense')->sum('amount');

        $sites = Site::query()->orderBy('name')->get(['id', 'name'])->map(fn (Site $site) => [
            'site_id' => $site->id,
            'site_name' => $site->name,
            'balance' => CashTransaction::currentSiteBalance($site->id),
        ]);

        return [
            'initial_balance' => (float) $account->initial_balance,
            'total_entries' => $totalEntries,
            'total_expenses' => $totalExpenses,
            'current_balance' => $account->currentBalance(),
            'sites' => $sites,
            'operations_count' => $account->transactions()->count(),
        ];
    }
}
