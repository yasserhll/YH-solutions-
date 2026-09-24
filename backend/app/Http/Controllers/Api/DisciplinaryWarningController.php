<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\DisciplinaryWarning;
use App\Models\Employee;
use App\Services\AuditLogger;
use Illuminate\Http\Request;

class DisciplinaryWarningController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = DisciplinaryWarning::with(['employee', 'site']);
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
        ];
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules());
        $employee = Employee::findOrFail($data['employee_id']);
        $this->ensureSiteAccess($request, $employee->site_id);

        $data['site_id'] = $employee->site_id;
        $data['created_by'] = $request->user()->id;

        $warning = DisciplinaryWarning::create($data);

        AuditLogger::log('warning.created', "Avertissement — {$employee->full_name} ({$warning->reason})", $warning->site_id, $warning);

        return response()->json($warning->load(['employee', 'site']), 201);
    }

    public function update(Request $request, DisciplinaryWarning $disciplinaryWarning)
    {
        $this->ensureSiteAccess($request, $disciplinaryWarning->site_id);
        $data = $request->validate($this->rules());
        $disciplinaryWarning->update($data);

        AuditLogger::log(
            'warning.updated',
            "Avertissement modifié — {$disciplinaryWarning->employee->full_name}",
            $disciplinaryWarning->site_id,
            $disciplinaryWarning
        );

        return $disciplinaryWarning->load(['employee', 'site']);
    }

    public function destroy(Request $request, DisciplinaryWarning $disciplinaryWarning)
    {
        $this->ensureSiteAccess($request, $disciplinaryWarning->site_id);
        $employeeName = $disciplinaryWarning->employee->full_name;
        $disciplinaryWarning->delete();

        AuditLogger::log('warning.deleted', "Avertissement supprimé — {$employeeName}", $disciplinaryWarning->site_id, $disciplinaryWarning);

        return response()->json(['message' => 'Avertissement supprimé.']);
    }
}
