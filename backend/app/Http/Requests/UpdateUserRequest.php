<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $userId = $this->route('user')->id;
        // See StoreUserRequest for why this can't just be `required_unless` +
        // `min:1` — that combination still fails on a present-but-empty
        // array, which is exactly the shape sent for a SuperAdmin.
        $isSuperAdmin = $this->input('role') === 'superadmin';

        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email,'.$userId],
            'password' => ['nullable', 'string', 'min:8'],
            'role' => ['required', Rule::in(['superadmin', 'responsable', 'hse', 'responsable_hse'])],
            'site_ids' => $isSuperAdmin ? ['sometimes', 'array'] : ['required', 'array', 'min:1'],
            'site_ids.*' => ['integer', 'exists:sites,id'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
