<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Assignment;
use App\Models\Employee;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AssignmentController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = Assignment::with(['employee', 'site', 'department', 'position']);
        $this->scopeToSite($query, $request);

        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }
        if ($departmentId = $request->query('department_id')) {
            $query->where('department_id', $departmentId);
        }
        if ($positionId = $request->query('position_id')) {
            $query->where('position_id', $positionId);
        }
        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
        }

        return $query->orderByDesc('start_date')->paginate($request->integer('per_page', 15));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'employee_id' => ['required', 'exists:employees,id'],
            'department_id' => ['nullable', 'exists:departments,id'],
            'position_id' => ['nullable', 'exists:positions,id'],
            'start_date' => ['required', 'date'],
            'notes' => ['nullable', 'string'],
        ]);

        $employee = Employee::findOrFail($data['employee_id']);
        $this->ensureSiteAccess($request, $employee->site_id);

        return DB::transaction(function () use ($data, $employee, $request) {
            Assignment::where('employee_id', $employee->id)
                ->where('is_current', true)
                ->update(['is_current' => false, 'end_date' => $data['start_date']]);

            $assignment = Assignment::create([
                ...$data,
                'site_id' => $employee->site_id,
                'is_current' => true,
                'created_by' => $request->user()->id,
            ]);

            $employee->update([
                'department_id' => $data['department_id'] ?? $employee->department_id,
                'position_id' => $data['position_id'] ?? $employee->position_id,
            ]);

            AuditLogger::log(
                'assignment.created',
                "Affectation — {$employee->full_name} ({$assignment->department?->name}, {$assignment->position?->name})",
                $assignment->site_id,
                $assignment
            );

            return response()->json($assignment->load(['employee', 'site', 'department', 'position']), 201);
        });
    }

    /**
     * Corrects a mistaken affectation (wrong department/position/date typed
     * in). A responsable may fix their own site's records — only the caisse
     * reserves edits to the SuperAdmin.
     */
    public function update(Request $request, Assignment $assignment)
    {
        $this->ensureSiteAccess($request, $assignment->site_id);

        $data = $request->validate([
            'department_id' => ['nullable', 'exists:departments,id'],
            'position_id' => ['nullable', 'exists:positions,id'],
            'start_date' => ['required', 'date'],
            'notes' => ['nullable', 'string'],
        ]);

        $assignment->update($data);

        if ($assignment->is_current) {
            $assignment->employee->update([
                'department_id' => $data['department_id'] ?? null,
                'position_id' => $data['position_id'] ?? null,
            ]);
        }

        AuditLogger::log(
            'assignment.updated',
            "Affectation modifiée — {$assignment->employee->full_name}",
            $assignment->site_id,
            $assignment
        );

        return $assignment->load(['employee', 'site', 'department', 'position']);
    }

    public function destroy(Request $request, Assignment $assignment)
    {
        $this->ensureSiteAccess($request, $assignment->site_id);
        $employeeName = $assignment->employee->full_name;
        $assignment->delete();

        AuditLogger::log('assignment.deleted', "Affectation supprimée — {$employeeName}", $assignment->site_id, $assignment);

        return response()->json(['message' => 'Affectation supprimée.']);
    }
}
