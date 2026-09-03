<?php

namespace App\Services;

use App\Models\CashAccount;
use App\Models\CashTransaction;
use Illuminate\Support\Facades\DB;

/**
 * Reproduces the ledger logic found in the reference Excel workbook:
 * balance = initial_balance + sum(entries) - sum(expenses), recomputed as a
 * running total ordered by date. Because a transaction can be edited/inserted
 * anywhere in the timeline (not just appended), every write recalculates the
 * running_balance of all transactions on the account from that point forward.
 *
 * A declared expense is never blocked for exceeding the available balance —
 * it's recorded as-is and the running balance simply goes negative until the
 * SuperAdmin records an "entry" (recharge). Rejecting the write would stop a
 * responsable from declaring a real purchase just because the caisse hasn't
 * been topped up yet, which is worse than a temporarily negative number.
 */
class CashLedgerService
{
    public function create(CashAccount $account, array $data): CashTransaction
    {
        return DB::transaction(function () use ($account, $data) {
            $data['running_balance'] = 0;
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
        $balance = (string) $account->initial_balance;

        $account->transactions()
            ->orderBy('date')
            ->orderBy('id')
            ->each(function (CashTransaction $transaction) use (&$balance) {
                $signed = $transaction->type === 'expense'
                    ? bcmul($transaction->amount, '-1', 2)
                    : (string) $transaction->amount;

                $balance = bcadd($balance, $signed, 2);
                $transaction->updateQuietly(['running_balance' => $balance]);
            });
    }

    public function summary(CashAccount $account): array
    {
        $totalEntries = (float) $account->transactions()->where('type', 'entry')->sum('amount');
        $totalExpenses = (float) $account->transactions()->where('type', 'expense')->sum('amount');

        return [
            'initial_balance' => (float) $account->initial_balance,
            'total_entries' => $totalEntries,
            'total_expenses' => $totalExpenses,
            'current_balance' => $account->currentBalance(),
            'operations_count' => $account->transactions()->count(),
        ];
    }
}
