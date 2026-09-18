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
            $status === 'termine' ? $query->finished() : $query->inProgress();
        }
        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }
        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
        }
        if ($month = $request->query('month')) {
            $period = Carbon::parse($month.'-01');
            $query->whereYear('start_date', $period->year)->whereMonth('start_date', $period->month);
        }

        // En cours first (soonest to end first among them), then Terminé,
        // most recently finished first — never buried under a long list of
        // already-finished leaves.
        $today = Carbon::today()->toDateString();

        return $query
            ->orderByRaw('CASE WHEN end_date < ? THEN 1 ELSE 0 END', [$today])
            ->orderByRaw('CASE WHEN end_date < ? THEN end_date END DESC', [$today])
            ->orderByRaw('CASE WHEN end_date >= ? THEN end_date END ASC', [$today])
            ->paginate($request->integer('per_page', 15));
    }

    public function store(StoreLeaveTakenRequest $request)
    {
        $employee = Employee::findOrFail($request->validated('employee_id'));
        $this->ensureSiteAccess($request, $employee->site_id);

        $data = $request->validated();
        $data['site_id'] = $employee->site_id;
        $data['created_by'] = $request->user()->id;
        $data['end_date'] = Leave::endDateForDuration(Carbon::parse($data['start_date']), $data['duration_days']);

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
            $newEndDate = Leave::extendEndDate(Carbon::parse($previousEndDate), $data['extra_days']);

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
        $data['end_date'] = Leave::endDateForDuration(Carbon::parse($data['start_date']), $data['duration_days']);
        $leave->update($data);

        return $leave->load(['employee', 'site', 'extensions']);
    }

    public function destroy(Request $request, Leave $leave)
    {
        $this->ensureSiteAccess($request, $leave->site_id);
        $leave->delete();

        return response()->json(['message' => 'Congé supprimé.']);
    }
}
