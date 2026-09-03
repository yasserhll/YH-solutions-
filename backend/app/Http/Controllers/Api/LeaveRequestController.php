<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreLeaveRequestRequest;
use App\Models\Employee;
use App\Models\LeaveRequest;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class LeaveRequestController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = LeaveRequest::with(['employee', 'site']);
        $this->scopeToSite($query, $request);

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }

        return $query->orderByDesc('request_date')->paginate($request->integer('per_page', 15));
    }

    public function store(StoreLeaveRequestRequest $request)
    {
        $employee = Employee::findOrFail($request->validated('employee_id'));
        $this->ensureSiteAccess($request, $employee->site_id);

        $data = $request->validated();
        $data['site_id'] = $employee->site_id;
        $data['created_by'] = $request->user()->id;

        $leaveRequest = LeaveRequest::create($data);

        return response()->json($leaveRequest->load(['employee', 'site']), 201);
    }

    public function update(StoreLeaveRequestRequest $request, LeaveRequest $leaveRequest)
    {
        $this->ensureSiteAccess($request, $leaveRequest->site_id);
        $leaveRequest->update($request->validated());

        return $leaveRequest->load(['employee', 'site']);
    }

    public function updateStatus(Request $request, LeaveRequest $leaveRequest)
    {
        $this->ensureSiteAccess($request, $leaveRequest->site_id);

        $data = $request->validate([
            'status' => ['required', Rule::in(['en_attente', 'acceptee', 'refusee', 'annulee'])],
        ]);
        $leaveRequest->update($data);

        return $leaveRequest->load(['employee', 'site']);
    }

    public function destroy(Request $request, LeaveRequest $leaveRequest)
    {
        $this->ensureSiteAccess($request, $leaveRequest->site_id);
        $leaveRequest->delete();

        return response()->json(['message' => 'Demande de congé supprimée.']);
    }
}
