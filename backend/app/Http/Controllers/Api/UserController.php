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

    /** Every session an account can be given, and each role's default set (Utilisateurs form). */
    public function modules()
    {
        return response()->json(['modules' => User::MODULES, 'role_defaults' => User::ROLE_MODULES]);
    }

    public function store(StoreUserRequest $request)
    {
        $data = $request->validated();
        $data['password'] = Hash::make($data['password']);
        $siteIds = $data['site_ids'] ?? [];
        unset($data['site_ids']);
        $data['modules'] = $this->normalizeModules($data['role'], $data['modules'] ?? null);

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
        $data['modules'] = $this->normalizeModules($data['role'], array_key_exists('modules', $data) ? $data['modules'] : $user->modules);

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
     * A SuperAdmin always has every session, so nothing is stored for them;
     * a list identical to the role's default is stored as null too, so the
     * account keeps following its role's default rather than a frozen copy.
     *
     * @param  array<int, string>|null  $modules
     * @return array<int, string>|null
     */
    protected function normalizeModules(string $role, ?array $modules): ?array
    {
        if ($role === 'superadmin' || $modules === null) {
            return null;
        }

        $modules = array_values(array_intersect(User::MODULES, $modules));
        $default = array_values(array_intersect(User::MODULES, User::ROLE_MODULES[$role] ?? []));

        return $modules === $default ? null : $modules;
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
