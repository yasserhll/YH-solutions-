<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Symfony\Component\HttpKernel\Exception\HttpException;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw new HttpException(422, 'Identifiants incorrects.');
        }

        if (! $user->is_active) {
            throw new HttpException(403, 'Ce compte est désactivé.');
        }

        $token = $user->createToken('spa')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => $this->present($user),
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Déconnecté.']);
    }

    public function me(Request $request)
    {
        return response()->json($this->present($request->user()));
    }

    /**
     * Switch a multi-site responsable's active site — the one site every
     * scoped read/write is forced onto until they switch again (see
     * InteractsWithSites::resolveSiteId/scopeToSite). A superadmin has no
     * active site concept and never calls this.
     */
    public function updateActiveSite(Request $request)
    {
        $user = $request->user();

        if ($user->isSuperAdmin()) {
            throw new HttpException(422, "Un SuperAdmin n'a pas de site actif.");
        }

        $data = $request->validate([
            'site_id' => ['required', 'integer'],
        ]);

        if (! $user->hasSiteAssigned($data['site_id'])) {
            throw new HttpException(403, "Ce site ne vous est pas affecté.");
        }

        $user->update(['active_site_id' => $data['site_id']]);

        return response()->json($this->present($user->fresh()));
    }

    protected function present(User $user): array
    {
        $user->loadMissing(['activeSite', 'sites']);

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'site' => $user->activeSite
                ? ['id' => $user->activeSite->id, 'name' => $user->activeSite->name, 'slug' => $user->activeSite->slug]
                : null,
            'sites' => $user->sites->map(fn ($s) => ['id' => $s->id, 'name' => $s->name, 'slug' => $s->slug])->values(),
        ];
    }
}
