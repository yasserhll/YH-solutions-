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
        return User::with('site')->orderBy('name')->get();
    }

    public function store(StoreUserRequest $request)
    {
        $data = $request->validated();
        $data['password'] = Hash::make($data['password']);
        if ($data['role'] === 'superadmin') {
            $data['site_id'] = null;
        }

        $user = User::create($data);

        return response()->json($user->load('site'), 201);
    }

    public function update(UpdateUserRequest $request, User $user)
    {
        $data = $request->validated();
        if (! empty($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        } else {
            unset($data['password']);
        }
        if ($data['role'] === 'superadmin') {
            $data['site_id'] = null;
        }

        $user->update($data);

        return $user->load('site');
    }

    public function destroy(User $user)
    {
        $user->delete();

        return response()->json(['message' => 'Utilisateur supprimé.']);
    }
}
