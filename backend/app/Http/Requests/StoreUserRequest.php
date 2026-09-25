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
        // A SuperAdmin has no assigned sites at all, so `site_ids` must be
        // allowed to be an empty/absent array for that role — `min:1` still
        // fires on a present-but-empty array even under `required_unless`,
        // which is exactly what made creating a second SuperAdmin fail
        // ("The site ids field must have at least 1 items.") whenever the
        // frontend sent `site_ids: []` alongside `role: superadmin`.
        $isSuperAdmin = $this->input('role') === 'superadmin';

        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
            'role' => ['required', Rule::in(['superadmin', 'responsable', 'hse', 'responsable_hse'])],
            'site_ids' => $isSuperAdmin ? ['sometimes', 'array'] : ['required', 'array', 'min:1'],
            'site_ids.*' => ['integer', 'exists:sites,id'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
