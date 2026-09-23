<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreEmployeeRequest;
use App\Models\Assignment;
use App\Models\Employee;
use App\Services\AttendanceAutomation;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

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

    /**
     * Access is gated on the employee's CURRENT site only (see
     * ensureSiteAccess below) — every relation here is then loaded by plain
     * employee_id, with no site filter of its own, so once a responsable can
     * open this employee at all they see the FULL history, including rows
     * whose own site_id belongs to a site the employee has since left (e.g.
     * an employee transferred from Louta to Mzinda: Mzinda's responsable
     * gets access the moment site_id flips, and immediately sees the
     * Louta-era pointage/congés/sanctions/heures sup/mouvements too). Each
     * relation also loads its own `site` so the frontend can label rows from
     * another site instead of silently implying they all happened here —
     * don't add a `scopeToSite`-style filter to any of these, that would
     * reintroduce exactly the gap this endpoint exists to avoid.
     */
    public function show(Request $request, Employee $employee)
    {
        $this->ensureSiteAccess($request, $employee->site_id);

        $employee->load([
            'site', 'department', 'position',
            'leaveRequests' => fn ($q) => $q->with('site')->latest('request_date'),
            'leaves' => fn ($q) => $q->with('site')->latest('start_date'),
            'leaves.extensions',
            'illnesses' => fn ($q) => $q->with('site')->latest('start_date'),
            'disciplinaryWarnings' => fn ($q) => $q->with('site')->latest('date'),
            'suspensions' => fn ($q) => $q->with('site')->latest('date'),
            'assignments' => fn ($q) => $q->with('site', 'department', 'position')->latest('start_date'),
            'overtimeEntries' => fn ($q) => $q->with('site')->latest('date'),
            'overtimeMonths' => fn ($q) => $q->with('site')->latest('month'),
            'entries' => fn ($q) => $q->with('site')->latest('entry_date'),
            'exits' => fn ($q) => $q->with('site')->latest('exit_date'),
        ]);

        // "attendances" here is NOT a plain Eloquent relation load — a
        // declared Maladie/Congé/Mise à pied period only ever produces a
        // real Attendance row for a day someone actually keyed in manually;
        // every other day in that period is a DEFAULT, computed on the fly
        // by AttendanceAutomation (exactly like the daily sheet and Rapports
        // already do — see AttendanceController::daily and
        // ReportController::attendanceRows). Loading only the real rows
        // here left the fiche's "Pointage" tab showing NOTHING for an
        // employee whose whole illness period was declared after the fact
        // and never individually keyed in day by day — even though the
        // person genuinely was absent that whole time. This merges the two
        // so the tab matches what Pointage/Rapports already show, no matter
        // how long ago the period was declared.
        $employee->setRelation('attendances', $this->attendanceHistory($employee));

        return $employee;
    }

    public function store(StoreEmployeeRequest $request)
    {
        $data = $request->validated();
        $data['site_id'] = $this->resolveSiteId($request);

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

    /**
     * A SuperAdmin can move an employee to another site by editing this
     * field directly (a responsable's own edits are always pinned back to
     * the employee's current site, just above). When that happens, the
     * current Assignment row must be closed and a new one opened on the
     * destination site — otherwise `assignments.is_current` would keep
     * pointing at the OLD site forever, contradicting `employees.site_id`
     * and leaving the transfer invisible on the "Affectations" tab, which is
     * exactly the trail this app promises to keep (see the cross-site
     * history note on `show()` above).
     */
    public function update(StoreEmployeeRequest $request, Employee $employee)
    {
        $this->ensureSiteAccess($request, $employee->site_id);

        $data = $request->validated();
        if (! $request->user()->isSuperAdmin()) {
            $data['site_id'] = $employee->site_id;
        }

        $siteChanged = isset($data['site_id']) && (int) $data['site_id'] !== $employee->site_id;

        $employee->update($data);

        if ($siteChanged) {
            $this->recordSiteTransfer($employee, $request->user()->id);
        }

        return $employee->load(['site', 'department', 'position']);
    }

    /**
     * The one-click "Affecter" action on the Affectations page — lets a
     * responsable (or a SuperAdmin) move an employee currently on one of
     * THEIR OWN sites to any other site, without going through the full
     * employee edit form. Site-only, on purpose: department/position are
     * left as-is (a responsable at the destination site can retouch them
     * afterwards via a normal affectation if needed).
     *
     * Unlike `update()` above — which pins a responsable's edits to their
     * own site because that's a "fix my own record" surface — sending an
     * employee elsewhere IS one of a responsable's own missions, so the gate
     * here is `ensureSiteAccess` on the employee's CURRENT site (exactly
     * like every other "fix/manage my own site's employee" action in this
     * controller), not a SuperAdmin-only check. The destination site is
     * deliberately unrestricted for everyone — a responsable doesn't need to
     * manage the destination to send someone there, only to currently manage
     * the employee being sent. Once the transfer lands, `ensureSiteAccess`
     * on the destination side is what naturally hands visibility to that
     * site's own responsable (see the cross-site history note on `show()`).
     */
    public function transferSite(Request $request, Employee $employee)
    {
        $this->ensureSiteAccess($request, $employee->site_id);

        $data = $request->validate([
            'site_id' => ['required', 'integer', 'exists:sites,id'],
        ]);

        if ((int) $data['site_id'] === $employee->site_id) {
            return $employee->load(['site', 'department', 'position']);
        }

        $employee->update(['site_id' => $data['site_id']]);
        $this->recordSiteTransfer($employee, $request->user()->id);

        return $employee->load(['site', 'department', 'position']);
    }

    public function destroy(Request $request, Employee $employee)
    {
        $this->ensureSiteAccess($request, $employee->site_id);
        $employee->delete();

        return response()->json(['message' => 'Employé supprimé.']);
    }

    /**
     * Real Attendance rows for this employee, merged with every auto-derived
     * absence day from their own declared Illness/Leave/Suspension periods
     * (a real row always wins — see AttendanceAutomation), sorted most
     * recent first. Unlike the daily sheet (one day) or Rapports (a picked
     * range), a fiche has no natural window to bound this to, so every
     * period's own full span is used (via null $from/$to) rather than an
     * arbitrary cutoff — a period from years ago must still show correctly.
     */
    private function attendanceHistory(Employee $employee): Collection
    {
        $realAttendances = $employee->attendances()->with('site')->get();

        $existingKeys = $realAttendances
            ->map(fn ($a) => $a->employee_id.'|'.$a->date->toDateString())
            ->all();

        $virtualRows = AttendanceAutomation::virtualRows(collect([$employee->id => $employee]), null, null, $existingKeys);

        $real = $realAttendances->map(fn ($a) => [
            'id' => $a->id,
            'employee_id' => $a->employee_id,
            'site_id' => $a->site_id,
            'date' => $a->date->toDateString(),
            'status' => $a->status,
            'absence_cause' => $a->absence_cause,
            'description' => $a->description,
            'site' => $a->site,
            'auto' => false,
        ]);

        $virtual = collect($virtualRows)->map(fn ($r) => [
            'id' => null,
            'employee_id' => $r['employee_id'],
            'site_id' => $r['site_id'],
            'date' => $r['date'],
            'status' => $r['status'],
            'absence_cause' => $r['absence_cause'],
            'description' => $r['description'],
            'site' => $employee->site,
            'auto' => true,
        ]);

        return $real->concat($virtual)->sortByDesc('date')->values()->take(60);
    }

    /**
     * Closes the employee's current Assignment and opens a new one on their
     * (already updated) site_id — keeps `assignments.is_current` truthful
     * after a site change instead of leaving it pointing at the old site
     * forever (see the cross-site history note on `show()` above).
     */
    private function recordSiteTransfer(Employee $employee, int $userId): void
    {
        Assignment::where('employee_id', $employee->id)
            ->where('is_current', true)
            ->update(['is_current' => false, 'end_date' => now()->toDateString()]);

        Assignment::create([
            'employee_id' => $employee->id,
            'site_id' => $employee->site_id,
            'department_id' => $employee->department_id,
            'position_id' => $employee->position_id,
            'start_date' => now()->toDateString(),
            'is_current' => true,
            'notes' => 'Affectation inter-site',
            'created_by' => $userId,
        ]);
    }
}
