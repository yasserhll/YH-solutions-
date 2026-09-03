<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreEmployeeRequest;
use App\Models\Assignment;
use App\Models\Employee;
use Illuminate\Http\Request;

class EmployeeController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = Employee::with(['site', 'department', 'position']);
        $this->scopeToSite($query, $request);

        if ($search = $request->query('search')) {
            $query->where('full_name', 'like', "%{$search}%");
        }
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($departmentId = $request->query('department_id')) {
            $query->where('department_id', $departmentId);
        }

        return $query->orderBy('full_name')->paginate($request->integer('per_page', 15));
    }

    public function show(Request $request, Employee $employee)
    {
        $this->ensureSiteAccess($request, $employee->site_id);

        return $employee->load([
            'site', 'department', 'position',
            'attendances' => fn ($q) => $q->latest('date')->limit(30),
            'leaveRequests' => fn ($q) => $q->latest('request_date'),
            'leaves.extensions',
            'disciplinaryWarnings' => fn ($q) => $q->latest('date'),
            'suspensions' => fn ($q) => $q->latest('date'),
            'assignments' => fn ($q) => $q->latest('start_date'),
        ]);
    }

    public function store(StoreEmployeeRequest $request)
    {
        $data = $request->validated();
        $data['site_id'] = $request->user()->isSuperAdmin() ? $data['site_id'] : $request->user()->site_id;

        $employee = Employee::create($data);

        Assignment::create([
            'employee_id' => $employee->id,
            'site_id' => $employee->site_id,
            'department_id' => $employee->department_id,
            'position_id' => $employee->position_id,
            'start_date' => $employee->entry_date ?? now(),
            'is_current' => true,
            'created_by' => $request->user()->id,
        ]);

        return response()->json($employee->load(['site', 'department', 'position']), 201);
    }

    public function update(StoreEmployeeRequest $request, Employee $employee)
    {
        $this->ensureSiteAccess($request, $employee->site_id);

        $data = $request->validated();
        if (! $request->user()->isSuperAdmin()) {
            $data['site_id'] = $employee->site_id;
        }

        $employee->update($data);

        return $employee->load(['site', 'department', 'position']);
    }

    public function destroy(Request $request, Employee $employee)
    {
        $this->ensureSiteAccess($request, $employee->site_id);
        $employee->delete();

        return response()->json(['message' => 'Employé supprimé.']);
    }
}
