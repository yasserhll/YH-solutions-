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
 * - site_running_balance: the remaining SPENDING LIMIT of the transaction's
 *   site's cash POOL (not a separate pot of real money) — see SiteCashPool:
 *   two or more sites managed by the same responsable share ONE balance
 *   rather than each having its own, so this is bucketed by pool, not by
 *   raw site_id. Moved only by `transfer` (+, the admin raises the pool's
 *   limit) and `expense` (-, consumes it). Null for `entry` rows.
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
        $poolLimits = [];

        $account->transactions()
            ->orderBy('date')
            ->orderBy('id')
            ->each(function (CashTransaction $transaction) use (&$masterBalance, &$poolLimits) {
                $siteLimit = null;

                switch ($transaction->type) {
                    case 'entry':
                        $masterBalance = bcadd($masterBalance, (string) $transaction->amount, 2);
                        break;

                    case 'transfer':
                        // Raises the pool's spending limit only — not a real
                        // money movement, the master balance is untouched.
                        // Bucketed by pool (see SiteCashPool), not raw
                        // site_id: a transfer "to Bouchane" also raises what
                        // Mzinda can spend when they share a responsable.
                        $poolKey = $this->poolKey($transaction->site_id);
                        $poolLimits[$poolKey] = bcadd($poolLimits[$poolKey] ?? '0.00', (string) $transaction->amount, 2);
                        $siteLimit = $poolLimits[$poolKey];
                        break;

                    case 'expense':
                        // Real money spent: debits both the master balance
                        // and the declaring site's pool's remaining limit.
                        $masterBalance = bcsub($masterBalance, (string) $transaction->amount, 2);
                        $poolKey = $this->poolKey($transaction->site_id);
                        $poolLimits[$poolKey] = bcsub($poolLimits[$poolKey] ?? '0.00', (string) $transaction->amount, 2);
                        $siteLimit = $poolLimits[$poolKey];
                        break;
                }

                $transaction->updateQuietly([
                    'running_balance' => $masterBalance,
                    'site_running_balance' => $siteLimit,
                ]);
            });
    }

    protected function poolKey(?int $siteId): ?int
    {
        if ($siteId === null) {
            return null;
        }

        $pool = SiteCashPool::forSite($siteId);
        sort($pool);

        return $pool[0];
    }

    public function summary(CashAccount $account): array
    {
        $totalEntries = (float) $account->transactions()->where('type', 'entry')->sum('amount');
        $totalExpenses = (float) $account->transactions()->where('type', 'expense')->sum('amount');

        // Grouped by cash pool (see SiteCashPool) so two sites sharing one
        // responsable's common caisse show ONE combined line — never the
        // same shared money counted twice under two different site names.
        $sites = SiteCashPool::groupedBalances(Site::query()->orderBy('name')->pluck('id')->all());

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
