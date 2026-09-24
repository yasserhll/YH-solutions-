<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Suspension;
use App\Services\AttendanceAutomation;
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
        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
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
        $data['end_date'] = Suspension::endDateForDuration(Carbon::parse($data['start_date']), $data['duration_days']);
        $data['created_by'] = $request->user()->id;

        $suspension = Suspension::create($data);

        // Same reconciliation as Illness: a real Attendance row entered
        // before this Mise à pied was declared would otherwise keep
        // shadowing the auto-derived "Absent - Mise à pied" default forever
        // on Pointage.
        AttendanceAutomation::reconcilePeriod($suspension->employee_id, $suspension->start_date->toDateString(), $suspension->end_date->toDateString());

        return response()->json($suspension->load(['employee', 'site']), 201);
    }

    public function update(Request $request, Suspension $suspension)
    {
        $this->ensureSiteAccess($request, $suspension->site_id);
        $data = $request->validate($this->rules());
        $data['end_date'] = Suspension::endDateForDuration(Carbon::parse($data['start_date']), $data['duration_days']);
        $suspension->update($data);
        AttendanceAutomation::reconcilePeriod($suspension->employee_id, $suspension->start_date->toDateString(), $suspension->end_date->toDateString());

        return $suspension->load(['employee', 'site']);
    }

    public function destroy(Request $request, Suspension $suspension)
    {
        $this->ensureSiteAccess($request, $suspension->site_id);
        $suspension->delete();

        return response()->json(['message' => 'Mise à pied supprimée.']);
    }
}
