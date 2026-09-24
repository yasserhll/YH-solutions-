<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreIllnessRequest;
use App\Models\Employee;
use App\Models\Illness;
use App\Services\AttendanceAutomation;
use App\Services\AuditLogger;
use Illuminate\Http\Request;

/**
 * A declared Maladie period — see App\Services\AttendanceAutomation, which is
 * what actually turns this into "Absent - Maladie" on the Pointage daily
 * sheet for every day in [start_date, end_date]. This controller only owns
 * the period record itself (create/correct/remove it), the same "fix your
 * own mistakes" pattern as Congés/Sanctions.
 */
class IllnessController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = Illness::with(['employee', 'site']);
        $this->scopeToSite($query, $request);

        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }
        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
        }

        return $query->orderByDesc('start_date')->paginate($request->integer('per_page', 15));
    }

    public function store(StoreIllnessRequest $request)
    {
        $employee = Employee::findOrFail($request->validated('employee_id'));
        $this->ensureSiteAccess($request, $employee->site_id);

        $data = $request->validated();
        $data['site_id'] = $employee->site_id;
        $data['created_by'] = $request->user()->id;

        $illness = Illness::create($data);

        // A real Attendance row entered before this Maladie was declared
        // (e.g. someone pointed "présent" on a day that turns out to be
        // covered by the certificate) would otherwise keep shadowing the
        // auto-derived "Absent - Maladie" default forever on Pointage.
        AttendanceAutomation::reconcilePeriod($illness->employee_id, $illness->start_date->toDateString(), $illness->end_date->toDateString());

        AuditLogger::log(
            'illness.declared',
            "Maladie déclarée — {$employee->full_name} du {$illness->start_date->format('d/m/Y')} au {$illness->end_date->format('d/m/Y')}",
            $illness->site_id,
            $illness
        );

        return response()->json($illness->load(['employee', 'site']), 201);
    }

    public function update(StoreIllnessRequest $request, Illness $illness)
    {
        $this->ensureSiteAccess($request, $illness->site_id);

        $illness->update($request->validated());
        AttendanceAutomation::reconcilePeriod($illness->employee_id, $illness->start_date->toDateString(), $illness->end_date->toDateString());

        AuditLogger::log(
            'illness.updated',
            "Maladie modifiée — {$illness->employee->full_name} du {$illness->start_date->format('d/m/Y')} au {$illness->end_date->format('d/m/Y')}",
            $illness->site_id,
            $illness
        );

        return $illness->load(['employee', 'site']);
    }

    public function destroy(Request $request, Illness $illness)
    {
        $this->ensureSiteAccess($request, $illness->site_id);
        $employeeName = $illness->employee->full_name;
        $illness->delete();

        AuditLogger::log('illness.deleted', "Maladie supprimée — {$employeeName}", $illness->site_id, $illness);

        return response()->json(['message' => 'Période de maladie supprimée.']);
    }
}
