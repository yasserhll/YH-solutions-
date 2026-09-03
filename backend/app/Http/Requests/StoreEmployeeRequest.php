<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreEmployeeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'full_name' => ['required', 'string', 'max:255'],
            'site_id' => [$this->user()->isSuperAdmin() ? 'required' : 'nullable', 'exists:sites,id'],
            'department_id' => ['nullable', 'exists:departments,id'],
            'position_id' => ['nullable', 'exists:positions,id'],
            'establishment' => ['nullable', 'string', 'max:255'],
            'entry_date' => ['nullable', 'date'],
            'status' => ['sometimes', Rule::in(['actif', 'sorti'])],
            'phone' => ['nullable', 'string', 'max:50'],
            'notes' => ['nullable', 'string'],
        ];
    }
}
