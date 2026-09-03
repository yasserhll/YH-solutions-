<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Assignment;
use App\Models\Employee;
use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EntryController extends Controller
{
    use InteractsWithSites;

    public function index(Request $request)
    {
        $query = Entry::with(['employee', 'site', 'department', 'position']);
        $this->scopeToSite($query, $request);

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
            ]);

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
        ]);

        $entry->update($data);

        if ($entry->employee_id) {
            $entry->employee->update([
                'full_name' => $data['full_name'],
                'position_id' => $data['position_id'] ?? null,
                'department_id' => $data['department_id'] ?? null,
                'establishment' => $data['establishment'] ?? null,
                'entry_date' => $data['entry_date'],
            ]);
        }

        return $entry->load(['employee', 'site', 'department', 'position']);
    }

    public function destroy(Request $request, Entry $entry)
    {
        $this->ensureSiteAccess($request, $entry->site_id);
        $entry->delete();

        return response()->json(['message' => 'Entrée supprimée.']);
    }
}
