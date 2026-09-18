<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\OvertimeEntry;
use App\Services\OvertimeLedgerService;
use App\Services\OvertimePayPeriod;
use Illuminate\Http\Request;

/**
 * A single "heures supplémentaires" declaration. Site-scoped exactly like
 * every other module (InteractsWithSites, derived from the declaring
 * employee's own site_id — same pattern as DisciplinaryWarningController).
 * Every write recalculates the declaring employee's entire monthly ledger
 * (OvertimeLedgerService) — see that class for why.
 */
class OvertimeEntryController extends Controller
{
    use InteractsWithSites;

    public function __construct(protected OvertimeLedgerService $ledger) {}

    public function index(Request $request)
    {
        $query = OvertimeEntry::with(['employee', 'site', 'creator']);
        $this->scopeToSite($query, $request);

        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }
        // ?month=YYYY-MM refers to the payroll PERIOD closing in that
        // calendar month (27 -> 26, see OvertimePayPeriod) — not the raw
        // calendar month a declaration's date falls in, so this stays
        // consistent with how /overtime-months buckets the same entries.
        if ($month = $request->query('month')) {
            [$start, $end] = OvertimePayPeriod::boundsForYearMonth($month);
            $query->whereBetween('date', [$start->toDateString(), $end->toDateString()]);
        }
        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
        }

        return $query->orderByDesc('date')->orderByDesc('id')->paginate($request->integer('per_page', 15));
    }

    protected function rules(): array
    {
        return [
            'employee_id' => ['required', 'exists:employees,id'],
            'date' => ['required', 'date'],
            'hours' => ['required', 'numeric', 'min:0.25', 'max:200'],
            'remark' => ['nullable', 'string'],
        ];
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules());
        $employee = Employee::findOrFail($data['employee_id']);
        $this->ensureSiteAccess($request, $employee->site_id);

        $data['site_id'] = $employee->site_id;
        $data['created_by'] = $request->user()->id;

        $entry = OvertimeEntry::create($data);
        $this->ledger->recalculate($employee);

        return response()->json($entry->load(['employee', 'site', 'creator']), 201);
    }

    public function update(Request $request, OvertimeEntry $overtimeEntry)
    {
        $this->ensureSiteAccess($request, $overtimeEntry->site_id);

        $data = $request->validate($this->rules());
        $employee = Employee::findOrFail($data['employee_id']);
        $this->ensureSiteAccess($request, $employee->site_id);

        $previousEmployee = $overtimeEntry->employee;
        $data['site_id'] = $employee->site_id;
        $overtimeEntry->update($data);

        // Recalculate both employees' ledgers if the declaration was
        // reassigned to a different person — a correction shouldn't leave
        // the original employee's ledger stuck with hours that moved away.
        if ($previousEmployee->id !== $employee->id) {
            $this->ledger->recalculate($previousEmployee);
        }
        $this->ledger->recalculate($employee);

        return $overtimeEntry->load(['employee', 'site', 'creator']);
    }

    public function destroy(Request $request, OvertimeEntry $overtimeEntry)
    {
        $this->ensureSiteAccess($request, $overtimeEntry->site_id);

        $employee = $overtimeEntry->employee;
        $overtimeEntry->delete();
        $this->ledger->recalculate($employee);

        return response()->json(['message' => 'Déclaration supprimée.']);
    }
}
