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

    protected function present(User $user): array
    {
        $user->loadMissing('site');

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'site' => $user->site ? ['id' => $user->site->id, 'name' => $user->site->name, 'slug' => $user->site->slug] : null,
        ];
    }
}
