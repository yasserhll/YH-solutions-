<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreAttendanceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'employee_id' => ['required', 'exists:employees,id'],
            'date' => ['required', 'date'],
            'status' => ['required', Rule::in(['present', 'absent'])],
            'absence_cause' => ['required_if:status,absent', 'nullable', Rule::in(['maladie', 'autorisee', 'non_autorisee', 'conge'])],
            'description' => ['nullable', 'string'],
        ];
    }
}
