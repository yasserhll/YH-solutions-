<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\CashAccount;
use App\Models\CashTransaction;
use App\Services\CashLedgerService;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Three transaction types share one ledger:
 *   - entry: SuperAdmin-only recharge of the master/common caisse, no site.
 *   - transfer: SuperAdmin-only, raises a destination site's spending LIMIT
 *     (site_id required) — NOT a real money movement, it never touches the
 *     master balance (see CashLedgerService). Never blocked.
 *   - expense: a site's declared purchase — real money, so it debits BOTH
 *     the master balance AND the declaring site's remaining limit. A
 *     responsable is auto-scoped to their own site, a superadmin must
 *     supply one. Blocked (422) if it would push that site's own limit
 *     below zero — a deliberate exception to the "never block" rule, which
 *     still holds for the master balance itself (entry/expense never
 *     blocked against it, same as before this feature).
 * A responsable never sees `entry` rows or the master running_balance, but
 * does see `transfer` rows crediting their own site and that site's own
 * site_running_balance (its remaining limit). See InteractsWithSites for
 * the site-scoping half.
 */
class CashTransactionController extends Controller
{
    use InteractsWithSites;

    public function __construct(protected CashLedgerService $ledger) {}

    public function index(Request $request)
    {
        $isSuperAdmin = $request->user()->isSuperAdmin();

        $query = CashTransaction::with(['site', 'creator']);
        $this->scopeToSite($query, $request);

        if (! $isSuperAdmin) {
            $query->whereIn('type', ['expense', 'transfer']);
        } elseif ($type = $request->query('type')) {
            $query->where('type', $type);
        }

        if ($from = $request->query('date_from')) {
            $query->whereDate('date', '>=', $from);
        }
        if ($to = $request->query('date_to')) {
            $query->whereDate('date', '<=', $to);
        }
        if ($beneficiary = $request->query('beneficiary')) {
            $query->where('beneficiary', 'like', "%{$beneficiary}%");
        }
        if ($search = $request->query('search')) {
            $query->where('description', 'like', "%{$search}%");
        }

        $paginated = $query->orderByDesc('date')->orderByDesc('id')->paginate($request->integer('per_page', 20));

        return $this->hideBalanceUnlessSuperAdmin($request, $paginated);
    }

    protected function rules(): array
    {
        return [
            'date' => ['required', 'date'],
            'type' => ['sometimes', Rule::in(['expense', 'entry', 'transfer'])],
            'beneficiary' => ['required_if:type,expense', 'nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'site_id' => ['required_if:type,transfer', 'sometimes', 'nullable', 'exists:sites,id'],
        ];
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules());
        $data['type'] = $data['type'] ?? 'expense';

        if (! $request->user()->isSuperAdmin() && $data['type'] !== 'expense') {
            throw new HttpException(403, 'Seul le SuperAdmin peut enregistrer cette opération.');
        }

        if ($data['type'] === 'expense') {
            // A purchase is always declared against a site — auto for a
            // responsable, required from a superadmin.
            $siteId = $this->resolveSiteId($request);
            $this->ensureSiteAccess($request, $siteId);
            $data['site_id'] = $siteId;

            $siteLimit = CashTransaction::currentSiteBalance($siteId);
            if (bccomp((string) $siteLimit, (string) $data['amount'], 2) < 0) {
                throw ValidationException::withMessages([
                    'amount' => ['Le solde de ce site ('.number_format($siteLimit, 2).' DH) est insuffisant pour cette dépense.'],
                ]);
            }
        } elseif ($data['type'] === 'transfer') {
            // site_id is the destination site, already validated above.
            // Never blocked: raising a site's limit isn't a real money
            // movement, it doesn't touch the master balance at all.
        } else {
            // An "entry"/recharge funds the shared caisse, not one site —
            // exactly like the site-less "Entree" rows in the reference Excel.
            $data['site_id'] = null;
        }

        $account = CashAccount::singleton();
        $data['created_by'] = $request->user()->id;

        $transaction = $this->ledger->create($account, $data);

        return response()->json(
            $this->hideBalanceUnlessSuperAdmin($request, $transaction->load(['site', 'creator'])),
            201
        );
    }

    /**
     * Editing/deleting an operation touches the balance recalculation, so it
     * is reserved to the SuperAdmin (also enforced by the `superadmin`
     * middleware on these routes — kept here too as defense in depth). Not
     * re-validated against either balance: a correction to history must
     * always be possible, same as today.
     */
    public function update(Request $request, CashTransaction $cashTransaction)
    {
        if (! $request->user()->isSuperAdmin()) {
            throw new HttpException(403, 'Réservé au SuperAdmin.');
        }

        $data = $request->validate($this->rules());
        $type = $data['type'] ?? $cashTransaction->type;
        $data['site_id'] = in_array($type, ['expense', 'transfer'], true)
            ? ($data['site_id'] ?? $cashTransaction->site_id)
            : null;

        $transaction = $this->ledger->update($cashTransaction, $data);

        return $transaction->load(['site', 'creator']);
    }

    public function destroy(Request $request, CashTransaction $cashTransaction)
    {
        if (! $request->user()->isSuperAdmin()) {
            throw new HttpException(403, 'Réservé au SuperAdmin.');
        }

        $this->ledger->delete($cashTransaction);

        return response()->json(['message' => 'Opération supprimée.']);
    }

    /**
     * @template T of CashTransaction|LengthAwarePaginator
     * @param  T  $subject
     * @return T
     */
    protected function hideBalanceUnlessSuperAdmin(Request $request, $subject)
    {
        if ($request->user()->isSuperAdmin()) {
            return $subject;
        }

        // Only the master running_balance is hidden — site_running_balance
        // is a responsable's own site's balance, which they're allowed to see.
        if ($subject instanceof LengthAwarePaginator) {
            $subject->getCollection()->each(fn (CashTransaction $t) => $t->makeHidden('running_balance'));

            return $subject;
        }

        return $subject->makeHidden('running_balance');
    }
}
