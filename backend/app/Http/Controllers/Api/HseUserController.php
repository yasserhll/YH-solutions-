<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Lets a `responsable_hse` create and manage `hse` (animateur) accounts for
 * their own assigned sites — a scoped, HSE-only alternative to the full
 * `/users` endpoint, which stays SuperAdmin-only. A SuperAdmin can also use
 * this (unrestricted, like everywhere else), but normally manages accounts
 * via the main Utilisateurs page instead. Route access (only `hse`,
 * `responsable_hse`, SuperAdmin reach this controller at all) is enforced by
 * the `hse.access` middleware in routes/api.php; the narrower "only a
 * responsable_hse/SuperAdmin, not an hse itself, may manage accounts" rule
 * is enforced here via ensureManager().
 */
class HseUserController extends Controller
{
    use InteractsWithSites;

    protected function ensureManager(Request $request): void
    {
        $user = $request->user();

        if (! $user->isSuperAdmin() && ! $user->isResponsableHse()) {
            throw new HttpException(403, 'Réservé au Responsable HSE.');
        }
    }

    /**
     * Every `site_id` in $siteIds must be one of the acting responsable_hse's
     * own assigned sites — never trust the request to hand an animateur off
     * to a site outside their control (a SuperAdmin has no such restriction).
     */
    protected function ensureSitesInScope(Request $request, array $siteIds): void
    {
        $user = $request->user();
        if ($user->isSuperAdmin()) {
            return;
        }

        $allowed = $user->assignedSiteIds();
        foreach ($siteIds as $siteId) {
            if (! in_array($siteId, $allowed, true)) {
                throw new HttpException(403, "Vous ne pouvez assigner que vos propres sites.");
            }
        }
    }

    public function index(Request $request)
    {
        $this->ensureManager($request);
        $user = $request->user();

        $query = User::where('role', 'hse')->with('sites');

        if (! $user->isSuperAdmin()) {
            $siteIds = $user->assignedSiteIds();
            $query->whereHas('sites', fn ($q) => $q->whereIn('sites.id', $siteIds));
        }

        return $query->orderBy('name')->get();
    }

    protected function rules(bool $requirePassword): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'password' => [$requirePassword ? 'required' : 'nullable', 'string', 'min:8'],
            'site_ids' => ['required', 'array', 'min:1'],
            'site_ids.*' => ['integer', 'exists:sites,id'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function store(Request $request)
    {
        $this->ensureManager($request);

        $data = $request->validate([
            ...$this->rules(true),
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
        ]);

        $this->ensureSitesInScope($request, $data['site_ids']);

        $siteIds = $data['site_ids'];
        unset($data['site_ids']);
        $data['role'] = 'hse';
        $data['password'] = Hash::make($data['password']);

        $hseUser = User::create($data);
        $hseUser->sites()->sync($siteIds);

        return response()->json($hseUser->load('sites'), 201);
    }

    public function update(Request $request, User $hseUser)
    {
        $this->ensureManager($request);
        $this->ensureTargetIsManagedHse($request, $hseUser);

        $data = $request->validate([
            ...$this->rules(false),
            'email' => ['required', 'email', 'max:255', 'unique:users,email,'.$hseUser->id],
        ]);

        $this->ensureSitesInScope($request, $data['site_ids']);

        $siteIds = $data['site_ids'];
        unset($data['site_ids']);
        if (! empty($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        } else {
            unset($data['password']);
        }

        $hseUser->update($data);
        $hseUser->sites()->sync($siteIds);

        return $hseUser->load('sites');
    }

    public function destroy(Request $request, User $hseUser)
    {
        $this->ensureManager($request);
        $this->ensureTargetIsManagedHse($request, $hseUser);

        $hseUser->delete();

        return response()->json(['message' => 'Compte animateur HSE supprimé.']);
    }

    /**
     * The target must actually be an `hse` account (never let this endpoint
     * touch a responsable, responsable_hse, or SuperAdmin account), and — for
     * a responsable_hse — must be assigned to at least one of their own
     * sites, mirroring the same site-scoping used everywhere else.
     */
    protected function ensureTargetIsManagedHse(Request $request, User $hseUser): void
    {
        if ($hseUser->role !== 'hse') {
            throw new HttpException(404, 'Compte introuvable.');
        }

        $user = $request->user();
        if ($user->isSuperAdmin()) {
            return;
        }

        $targetSiteIds = $hseUser->sites->pluck('id')->all();
        $allowed = $user->assignedSiteIds();

        if (empty(array_intersect($targetSiteIds, $allowed))) {
            throw new HttpException(403, "Vous n'avez pas accès à ce compte.");
        }
    }
}
