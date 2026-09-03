<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreLeaveRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'employee_id' => ['required', 'exists:employees,id'],
            'request_date' => ['required', 'date'],
            'desired_start_date' => ['required', 'date'],
            'duration_days' => ['required', 'integer', 'min:1'],
            'reason' => ['nullable', 'string'],
            'status' => ['sometimes', Rule::in(['en_attente', 'acceptee', 'refusee', 'annulee'])],
        ];
    }
}
