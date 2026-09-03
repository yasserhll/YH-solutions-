<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Suspension;
use Carbon\Carbon;
use Illuminate\Http\Request;

class SuspensionController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = Suspension::with(['employee', 'site']);
        $this->scopeToSite($query, $request);

        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }

        return $query->orderByDesc('date')->paginate($request->integer('per_page', 15));
    }

    protected function rules(): array
    {
        return [
            'employee_id' => ['required', 'exists:employees,id'],
            'date' => ['required', 'date'],
            'reason' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'duration_days' => ['required', 'integer', 'min:1'],
            'start_date' => ['required', 'date'],
        ];
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules());
        $employee = Employee::findOrFail($data['employee_id']);
        $this->ensureSiteAccess($request, $employee->site_id);

        $data['site_id'] = $employee->site_id;
        $data['end_date'] = Carbon::parse($data['start_date'])->addDays($data['duration_days'] - 1);
        $data['created_by'] = $request->user()->id;

        $suspension = Suspension::create($data);

        return response()->json($suspension->load(['employee', 'site']), 201);
    }

    public function update(Request $request, Suspension $suspension)
    {
        $this->ensureSiteAccess($request, $suspension->site_id);
        $data = $request->validate($this->rules());
        $data['end_date'] = Carbon::parse($data['start_date'])->addDays($data['duration_days'] - 1);
        $suspension->update($data);

        return $suspension->load(['employee', 'site']);
    }

    public function destroy(Request $request, Suspension $suspension)
    {
        $this->ensureSiteAccess($request, $suspension->site_id);
        $suspension->delete();

        return response()->json(['message' => 'Mise à pied supprimée.']);
    }
}
