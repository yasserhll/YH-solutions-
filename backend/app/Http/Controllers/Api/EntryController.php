<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Assignment;
use App\Models\Contract;
use App\Models\Employee;
use App\Models\Entry;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EntryController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        // A person deleted in Personnel / Affectations disappears from
        // Entrées too (soft delete: the row is kept, just no longer listed).
        $query = Entry::with(['employee', 'site', 'department', 'position'])
            ->where(fn ($q) => $q->whereNull('employee_id')->orWhereHas('employee'));
        $this->scopeToSite($query, $request);

        if ($search = $request->query('search')) {
            $query->where('full_name', 'like', "%{$search}%");
        }

        return $query->orderByDesc('entry_date')->paginate($request->integer('per_page', 15));
    }

    /**
     * Recording an entry creates (or updates) the corresponding employee and
     * its current assignment in one step — the user never re-types data that
     * already exists.
     */
    public function store(Request $request)
    {
        $data = $request->validate([
            'full_name' => ['required', 'string', 'max:255'],
            'position_id' => ['nullable', 'exists:positions,id'],
            'department_id' => ['nullable', 'exists:departments,id'],
            'establishment' => ['nullable', 'string', 'max:255'],
            'entry_date' => ['required', 'date'],
            'cin_expiry_date' => ['nullable', 'date'],
            'is_driver' => ['sometimes', 'boolean'],
            'license_expiry_date' => ['nullable', 'date'],
        ]);

        $siteId = $this->resolveSiteId($request);

        return DB::transaction(function () use ($data, $siteId, $request) {
            $employee = Employee::create([
                'full_name' => $data['full_name'],
                'site_id' => $siteId,
                'department_id' => $data['department_id'] ?? null,
                'position_id' => $data['position_id'] ?? null,
                'establishment' => $data['establishment'] ?? null,
                'entry_date' => $data['entry_date'],
                'status' => 'actif',
            ] + $this->documentFields($data));

            Assignment::create([
                'employee_id' => $employee->id,
                'site_id' => $siteId,
                'department_id' => $data['department_id'] ?? null,
                'position_id' => $data['position_id'] ?? null,
                'start_date' => $data['entry_date'],
                'is_current' => true,
                'created_by' => $request->user()->id,
            ]);

            $entry = Entry::create([
                'employee_id' => $employee->id,
                'full_name' => $data['full_name'],
                'position_id' => $data['position_id'] ?? null,
                'department_id' => $data['department_id'] ?? null,
                'establishment' => $data['establishment'] ?? null,
                'site_id' => $siteId,
                'entry_date' => $data['entry_date'],
                'created_by' => $request->user()->id,
            ]);

            // Every new entry signs a 3-month CDD (Contrats session).
            Contract::openFirstCdd($employee, $data['entry_date'], $request->user()->id);

            AuditLogger::log('entry.created', "Entrée — {$data['full_name']}", $siteId, $entry);

            return response()->json($entry->load(['employee', 'site', 'department', 'position']), 201);
        });
    }

    /**
     * Corrects a mistaken entry record (typo in name/date/department...). A
     * responsable may fix their own site's records — only the caisse
     * reserves edits to the SuperAdmin.
     */
    public function update(Request $request, Entry $entry)
    {
        $this->ensureSiteAccess($request, $entry->site_id);

        $data = $request->validate([
            'full_name' => ['required', 'string', 'max:255'],
            'position_id' => ['nullable', 'exists:positions,id'],
            'department_id' => ['nullable', 'exists:departments,id'],
            'establishment' => ['nullable', 'string', 'max:255'],
            'entry_date' => ['required', 'date'],
            'cin_expiry_date' => ['nullable', 'date'],
            'is_driver' => ['sometimes', 'boolean'],
            'license_expiry_date' => ['nullable', 'date'],
        ]);

        $previousEntryDate = $entry->entry_date?->toDateString();
        $entry->update(array_diff_key($data, array_flip(['cin_expiry_date', 'is_driver', 'license_expiry_date'])));

        // A corrected entry date moves the first contract with it, as long
        // as nothing was decided on it yet.
        if ($entry->employee_id && $previousEntryDate && $previousEntryDate !== $entry->entry_date->toDateString()) {
            $first = Contract::where('employee_id', $entry->employee_id)
                ->whereNull('outcome')->where('type', 'cdd')
                ->whereDate('start_date', $previousEntryDate)
                ->first();
            $first?->update([
                'start_date' => $entry->entry_date->toDateString(),
                'end_date' => Contract::endFor($entry->entry_date, $first->duration_months ?? Contract::DEFAULT_MONTHS)->toDateString(),
            ]);
        }

        if ($entry->employee_id) {
            $entry->employee->update([
                'full_name' => $data['full_name'],
                'position_id' => $data['position_id'] ?? null,
                'department_id' => $data['department_id'] ?? null,
                'establishment' => $data['establishment'] ?? null,
                'entry_date' => $data['entry_date'],
            ] + $this->documentFields($data));
        }

        AuditLogger::log('entry.updated', "Entrée modifiée — {$entry->full_name}", $entry->site_id, $entry);

        return $entry->load(['employee', 'site', 'department', 'position']);
    }

    /**
     * Personnel, Affectations and Entrées delete together (user's rule,
     * 2026-11-10): deleting the entry of an existing person deletes the
     * PERSON (same soft delete as Personnel, so the entry row and the whole
     * history stay in the database, just no longer listed anywhere). That
     * needs the Personnel session. An entry with no linked employee is
     * simply removed, as before.
     */
    public function destroy(Request $request, Entry $entry)
    {
        $this->ensureSiteAccess($request, $entry->site_id);
        $fullName = $entry->full_name;
        $employee = $entry->employee;

        if ($employee) {
            abort_unless(
                $request->user()->hasModule('personnel'),
                403,
                "Supprimer une personne demande l'accès à la session Personnel."
            );
            $this->ensureSiteAccess($request, $employee->site_id);
            $employee->delete();

            AuditLogger::log('employee.deleted', "Employé supprimé depuis Entrées — {$employee->full_name}", $employee->site_id, $employee);

            return response()->json(['message' => 'Personne supprimée de Personnel, des Affectations et des Entrées.']);
        }

        $entry->delete();

        AuditLogger::log('entry.deleted', "Entrée supprimée — {$fullName}", $entry->site_id, $entry);

        return response()->json(['message' => 'Entrée supprimée.']);
    }

    /**
     * CIN / permis expiry dates live on the employee (followed in Contrats →
     * CIN / Permis). Only the keys actually sent are written, and a
     * non-driver never keeps a permis date.
     */
    private function documentFields(array $data): array
    {
        $fields = array_intersect_key($data, array_flip(['cin_expiry_date', 'is_driver', 'license_expiry_date']));
        if (array_key_exists('is_driver', $fields)) {
            $fields['driver_opt_out'] = ! $fields['is_driver'];
            if (! $fields['is_driver']) {
                $fields['license_expiry_date'] = null;
            }
        }

        return $fields;
    }
}
