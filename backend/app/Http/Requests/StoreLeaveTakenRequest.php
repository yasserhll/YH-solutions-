<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreLeaveTakenRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'employee_id' => ['required', 'exists:employees,id'],
            'leave_request_id' => ['nullable', 'exists:leave_requests,id'],
            'start_date' => ['required', 'date'],
            'duration_days' => ['required', 'integer', 'min:1'],
            'reason' => ['nullable', 'string'],
        ];
    }
}
