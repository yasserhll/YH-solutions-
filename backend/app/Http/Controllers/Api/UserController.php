<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

class UserController extends Controller
{
    public function index()
    {
        return User::with(['sites', 'activeSite'])->orderBy('name')->get();
    }

    public function store(StoreUserRequest $request)
    {
        $data = $request->validated();
        $data['password'] = Hash::make($data['password']);
        $siteIds = $data['site_ids'] ?? [];
        $activeSiteId = $data['active_site_id'] ?? null;
        unset($data['site_ids'], $data['active_site_id']);

        $data['active_site_id'] = $data['role'] === 'superadmin' ? null : $this->resolveActiveSiteId($siteIds, $activeSiteId);

        $user = User::create($data);

        if ($data['role'] !== 'superadmin') {
            $user->sites()->sync($siteIds);
        }

        return response()->json($user->load(['sites', 'activeSite']), 201);
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
        $activeSiteId = $data['active_site_id'] ?? null;
        unset($data['site_ids'], $data['active_site_id']);

        $data['active_site_id'] = $data['role'] === 'superadmin' ? null : $this->resolveActiveSiteId($siteIds, $activeSiteId);

        $user->update($data);
        $user->sites()->sync($data['role'] === 'superadmin' ? [] : $siteIds);

        return $user->load(['sites', 'activeSite']);
    }

    public function destroy(User $user)
    {
        $user->delete();

        return response()->json(['message' => 'Utilisateur supprimé.']);
    }

    /**
     * The active site must be one of the assigned sites — default to the
     * first one when the form didn't pick one explicitly.
     */
    private function resolveActiveSiteId(array $siteIds, ?int $activeSiteId): ?int
    {
        if ($activeSiteId && in_array($activeSiteId, $siteIds, true)) {
            return $activeSiteId;
        }

        return $siteIds[0] ?? null;
    }
}
