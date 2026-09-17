<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Models\CashAccount;
use App\Models\User;
use App\Services\CashLedgerService;
use Illuminate\Support\Facades\Hash;

class UserController extends Controller
{
    public function __construct(protected CashLedgerService $ledger) {}

    public function index()
    {
        return User::with('sites')->orderBy('name')->get();
    }

    public function store(StoreUserRequest $request)
    {
        $data = $request->validated();
        $data['password'] = Hash::make($data['password']);
        $siteIds = $data['site_ids'] ?? [];
        unset($data['site_ids']);

        $user = User::create($data);

        if ($data['role'] !== 'superadmin') {
            $user->sites()->sync($siteIds);
            $this->recalculateCashPools();
        }

        return response()->json($user->load('sites'), 201);
    }

    public function update(UpdateUserRequest $request, User $user)
    {
        $data = $request->validated();
        if (! empty($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        } else {
            unset($data['password']);
        }
        $siteIds = $data['site_ids'] ?? [];
        unset($data['site_ids']);

        $user->update($data);
        $user->sites()->sync($data['role'] === 'superadmin' ? [] : $siteIds);
        $this->recalculateCashPools();

        return $user->load('sites');
    }

    public function destroy(User $user)
    {
        $user->delete();
        $this->recalculateCashPools();

        return response()->json(['message' => 'Utilisateur supprimé.']);
    }

    /**
     * Which sites share a common caisse (SiteCashPool) is derived from
     * site_user, so creating/editing/deleting a responsable can reshape a
     * pool (merge two sites' balances, or split them back apart) — e.g.
     * assigning Fatima to both Bouchane and Mzinda must make their combined
     * balance visible immediately, not only after the next cash transaction
     * happens to trigger a recalculation. cash_transactions.site_running_balance
     * is a derived/cached column (see CashLedgerService), so every
     * site-assignment change must re-derive it right away.
     */
    protected function recalculateCashPools(): void
    {
        $this->ledger->recalculate(CashAccount::singleton());
    }
}
