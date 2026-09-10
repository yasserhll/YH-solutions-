<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
            'role' => ['required', Rule::in(['superadmin', 'responsable'])],
            'site_ids' => ['required_if:role,responsable', 'array', 'min:1'],
            'site_ids.*' => ['integer', 'exists:sites,id'],
            'active_site_id' => ['nullable', 'integer', 'exists:sites,id'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
