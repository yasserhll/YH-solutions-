<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreLeaveTakenRequest;
use App\Models\Employee;
use App\Models\Leave;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LeaveController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = Leave::with(['employee', 'site', 'extensions']);
        $this->scopeToSite($query, $request);

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }

        return $query->orderByDesc('start_date')->paginate($request->integer('per_page', 15));
    }

    public function store(StoreLeaveTakenRequest $request)
    {
        $employee = Employee::findOrFail($request->validated('employee_id'));
        $this->ensureSiteAccess($request, $employee->site_id);

        $data = $request->validated();
        $data['site_id'] = $employee->site_id;
        $data['created_by'] = $request->user()->id;
        $data['status'] = 'en_cours';
        $data['end_date'] = Carbon::parse($data['start_date'])->addDays($data['duration_days'] - 1);

        $leave = Leave::create($data);

        return response()->json($leave->load(['employee', 'site', 'extensions']), 201);
    }

    public function extend(Request $request, Leave $leave)
    {
        $this->ensureSiteAccess($request, $leave->site_id);

        $data = $request->validate([
            'extra_days' => ['required', 'integer', 'min:1'],
            'reason' => ['nullable', 'string'],
        ]);

        return DB::transaction(function () use ($leave, $data, $request) {
            $previousEndDate = $leave->end_date;
            $newEndDate = Carbon::parse($previousEndDate)->addDays($data['extra_days']);

            $leave->extensions()->create([
                'extra_days' => $data['extra_days'],
                'reason' => $data['reason'] ?? null,
                'previous_end_date' => $previousEndDate,
                'new_end_date' => $newEndDate,
                'created_by' => $request->user()->id,
            ]);

            $leave->update([
                'end_date' => $newEndDate,
                'duration_days' => $leave->duration_days + $data['extra_days'],
            ]);

            return $leave->load(['employee', 'site', 'extensions']);
        });
    }

    public function update(StoreLeaveTakenRequest $request, Leave $leave)
    {
        $this->ensureSiteAccess($request, $leave->site_id);

        $data = $request->validated();
        $data['end_date'] = Carbon::parse($data['start_date'])->addDays($data['duration_days'] - 1);
        $leave->update($data);

        return $leave->load(['employee', 'site', 'extensions']);
    }

    public function updateStatus(Request $request, Leave $leave)
    {
        $this->ensureSiteAccess($request, $leave->site_id);
        $data = $request->validate(['status' => ['required', 'in:en_cours,termine']]);
        $leave->update($data);

        return $leave;
    }

    public function destroy(Request $request, Leave $leave)
    {
        $this->ensureSiteAccess($request, $leave->site_id);
        $leave->delete();

        return response()->json(['message' => 'Congé supprimé.']);
    }
}
