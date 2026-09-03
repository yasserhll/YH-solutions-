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
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Reproduces the reference Excel exactly: a site's own sheet only ever lists
 * that site's declared purchases (expenses) — no "Entree" rows, no solde/reste
 * column. Only the "Admin" sheet (the SuperAdmin here) sees entries and the
 * running reste. A responsable therefore:
 *   - can only create type=expense, always tied to their own site
 *   - never receives type=entry rows at all, even mixed into a listing
 *   - never receives the running_balance field
 *   - can never update/destroy an operation (see routes/api.php)
 * See InteractsWithSites for the site-scoping half of this.
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
            $query->where('type', 'expense');
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
            'type' => ['sometimes', Rule::in(['expense', 'entry'])],
            'beneficiary' => ['required_if:type,expense', 'nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'site_id' => ['sometimes', 'nullable', 'exists:sites,id'],
        ];
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules());
        $data['type'] = $data['type'] ?? 'expense';

        if (! $request->user()->isSuperAdmin() && $data['type'] !== 'expense') {
            throw new HttpException(403, 'Seul le SuperAdmin peut enregistrer une entrée de caisse.');
        }

        if ($data['type'] === 'expense') {
            // A purchase is always declared against a site — auto for a
            // responsable, required from a superadmin.
            $siteId = $this->resolveSiteId($request);
            $this->ensureSiteAccess($request, $siteId);
            $data['site_id'] = $siteId;
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
     * middleware on these routes — kept here too as defense in depth).
     */
    public function update(Request $request, CashTransaction $cashTransaction)
    {
        if (! $request->user()->isSuperAdmin()) {
            throw new HttpException(403, 'Réservé au SuperAdmin.');
        }

        $data = $request->validate($this->rules());
        $data['site_id'] = ($data['type'] ?? $cashTransaction->type) === 'expense'
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

        if ($subject instanceof LengthAwarePaginator) {
            $subject->getCollection()->each(fn (CashTransaction $t) => $t->makeHidden('running_balance'));

            return $subject;
        }

        return $subject->makeHidden('running_balance');
    }
}
