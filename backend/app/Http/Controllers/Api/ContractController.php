<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\InteractsWithSites;
use App\Http\Controllers\Controller;
use App\Models\Assignment;
use App\Models\Attendance;
use App\Models\Contract;
use App\Models\Employee;
use App\Models\EmployeeExit;
use App\Services\AuditLogger;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Contrats session. A contract follows its employee: it is scoped by the
 * employee's CURRENT site (like the fiche employé), so a transferred
 * employee's contract moves with them to the new site's responsable.
 */
class ContractController extends Controller
{
    use InteractsWithSites;

    protected function scoped(Request $request): Builder
    {
        $employees = Employee::query()->select('id');
        $this->scopeToSite($employees, $request);

        return Contract::query()->whereIn('employee_id', $employees);
    }

    public function index(Request $request)
    {
        Contract::promoteDueToCdi();

        $query = $this->scoped($request)
            ->with(['employee:id,full_name,status,site_id,position_id,entry_date', 'employee.site:id,name', 'employee.position:id,name'])
            ->inState((string) $request->query('state', ''))
            ->withCddNumber();

        // ?rank=1|2|3 — 1er CDD, 2ème CDD, 3ème CDD et plus.
        if ($rank = $request->integer('rank')) {
            $query->withCddRank(min($rank, 3), $rank >= 3);
        }

        if ($search = $request->query('search')) {
            $query->whereHas('employee', fn ($q) => $q->where('full_name', 'like', "%{$search}%"));
        }

        // Most urgent first: open CDDs by end date, CDIs after them.
        $query->orderByRaw("type = 'cdi'")->orderByRaw('end_date IS NULL')->orderBy('end_date')->orderByDesc('id');

        return $query->paginate($request->integer('per_page', 15));
    }

    /** Alert counts (Contrats KPIs + the dashboard banner). */
    public function summary(Request $request)
    {
        Contract::promoteDueToCdi();

        $count = fn (string $state) => $this->scoped($request)->inState($state)->count();

        return [
            'en_cours' => $count('en_cours'),
            'bientot' => $count('bientot'),
            'termine' => $count('termine'),
            'cdi' => $count('cdi'),
            'alert_days' => Contract::ALERT_DAYS,
        ];
    }

    /** A contract typed by hand (e.g. an employee who has none yet). */
    public function store(Request $request)
    {
        $data = $request->validate([
            'employee_id' => ['required', 'exists:employees,id'],
            'type' => ['required', 'in:cdd,cdi'],
            'start_date' => ['required', 'date'],
            'duration_months' => ['required_if:type,cdd', 'nullable', 'integer', 'min:1', 'max:120'],
            'notes' => ['nullable', 'string'],
        ]);

        $employee = Employee::findOrFail($data['employee_id']);
        $this->ensureSiteAccess($request, $employee->site_id);

        if (Contract::where('employee_id', $employee->id)->whereNull('outcome')->exists()) {
            abort(422, "{$employee->full_name} a déjà un contrat en cours : utilisez Renouveler, CDI ou Sortie sur ce contrat.");
        }

        $contract = Contract::create($this->shape($data) + [
            'employee_id' => $employee->id,
            'site_id' => $employee->site_id,
            'created_by' => $request->user()->id,
        ]);

        AuditLogger::log('contract.created', "Contrat {$this->label($contract)} — {$employee->full_name} à partir du {$contract->start_date->format('d/m/Y')}", $employee->site_id, $contract);

        return response()->json($this->loadFor($contract), 201);
    }

    /** Corrects a contract's dates/type/notes (a typo, a wrong duration). */
    public function update(Request $request, Contract $contract)
    {
        $this->ensureSiteAccess($request, $contract->employee->site_id);

        $data = $request->validate([
            'type' => ['required', 'in:cdd,cdi'],
            'start_date' => ['required', 'date'],
            'duration_months' => ['required_if:type,cdd', 'nullable', 'integer', 'min:1', 'max:120'],
            'notes' => ['nullable', 'string'],
            'auto_cdi' => ['sometimes', 'boolean'],
            'cdd_number' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:20'],
        ]);

        $extra = array_key_exists('auto_cdi', $data) ? ['auto_cdi' => $data['auto_cdi']] : [];
        if (array_key_exists('cdd_number', $data)) {
            // 1er / 2ème / 3ème CDD picked by hand; stored only when it differs
            // from what the history gives, so the number keeps following it otherwise.
            $chosen = $data['type'] === 'cdd' ? $data['cdd_number'] : null;
            $extra['rank_override'] = ($chosen && $chosen !== $contract->computedCddNumber()) ? $chosen : null;
        }

        $contract->update($this->shape($data) + $extra);

        AuditLogger::log('contract.updated', "Contrat modifié — {$contract->employee->full_name}", $contract->employee->site_id, $contract);

        return $this->loadFor($contract);
    }

    /**
     * Deleting a mistaken contract. If it came from a renouvellement / CDI on
     * the previous contract, that previous one becomes the current one again
     * (the decision is undone). A contract closed by a sortie can't be
     * deleted here: cancel the Sortie in Entrées/Sorties instead.
     */
    public function destroy(Request $request, Contract $contract)
    {
        abort_unless($request->user()->isSuperAdmin(), 403, 'Seul le SuperAdmin peut supprimer un contrat.');
        $this->ensureSiteAccess($request, $contract->employee->site_id);

        if ($contract->outcome === 'stc') {
            abort(422, 'Ce contrat a été clôturé par une sortie : annulez la sortie dans Entrées / Sorties.');
        }

        return DB::transaction(function () use ($contract) {
            $name = $contract->employee->full_name;

            if (! $contract->outcome) {
                Contract::where('employee_id', $contract->employee_id)
                    ->where('id', '!=', $contract->id)
                    ->whereIn('outcome', ['renouvele', 'cdi'])
                    ->orderByDesc('start_date')->orderByDesc('id')
                    ->first()
                    // auto_cdi off: a deleted (automatic) CDI must not come straight back.
                    ?->update(['outcome' => null, 'outcome_date' => null, 'auto_cdi' => false]);
            }

            $contract->delete();

            AuditLogger::log('contract.deleted', "Contrat supprimé — {$name}", $contract->employee->site_id, $contract);

            return response()->json(['message' => 'Contrat supprimé.']);
        });
    }

    /** Renouveler: closes this CDD and opens a new one (3 months by default) the day after it ends. */
    public function renew(Request $request, Contract $contract)
    {
        $this->ensureOpenCdd($request, $contract);

        $data = $request->validate([
            'start_date' => ['nullable', 'date'],
            'duration_months' => ['nullable', 'integer', 'min:1', 'max:120'],
        ]);

        $start = Carbon::parse($data['start_date'] ?? $contract->end_date->copy()->addDay());
        $months = $data['duration_months'] ?? Contract::DEFAULT_MONTHS;

        $next = DB::transaction(function () use ($contract, $start, $months, $request) {
            $contract->update(['outcome' => 'renouvele', 'outcome_date' => $start->toDateString()]);

            return Contract::create([
                'employee_id' => $contract->employee_id,
                'site_id' => $contract->employee->site_id,
                'type' => 'cdd',
                'start_date' => $start->toDateString(),
                'end_date' => Contract::endFor($start, $months)->toDateString(),
                'duration_months' => $months,
                'created_by' => $request->user()->id,
            ]);
        });

        AuditLogger::log('contract.renewed', "Contrat renouvelé ({$months} mois) — {$contract->employee->full_name} jusqu'au {$next->end_date->format('d/m/Y')}", $contract->employee->site_id, $next);

        return response()->json($this->loadFor($next), 201);
    }

    /** Passer en CDI: closes this CDD and opens an open-ended CDI. */
    public function makeCdi(Request $request, Contract $contract)
    {
        $this->ensureOpenCdd($request, $contract);

        $data = $request->validate(['start_date' => ['nullable', 'date']]);
        $start = Carbon::parse($data['start_date'] ?? $contract->end_date->copy()->addDay());

        $cdi = DB::transaction(function () use ($contract, $start, $request) {
            $contract->update(['outcome' => 'cdi', 'outcome_date' => $start->toDateString()]);

            return Contract::create([
                'employee_id' => $contract->employee_id,
                'site_id' => $contract->employee->site_id,
                'type' => 'cdi',
                'start_date' => $start->toDateString(),
                'created_by' => $request->user()->id,
            ]);
        });

        AuditLogger::log('contract.cdi', "Passage en CDI — {$contract->employee->full_name} à partir du {$start->format('d/m/Y')}", $contract->employee->site_id, $cdi);

        return response()->json($this->loadFor($cdi), 201);
    }

    /**
     * Sortie (STC): closes the contract and records the departure exactly
     * like Entrées/Sorties → Nouvelle sortie does (exits row, employee
     * "sorti", current assignment closed). Cancelling that Sortie later
     * (ExitController@destroy / RevertsEmployeeDeparture) reopens the contract.
     */
    public function stc(Request $request, Contract $contract)
    {
        $this->ensureSiteAccess($request, $contract->employee->site_id);
        if ($contract->outcome) {
            abort(422, 'Ce contrat est déjà clôturé.');
        }
        if ($contract->employee->status === 'sorti') {
            abort(422, "{$contract->employee->full_name} est déjà sorti(e).");
        }

        $data = $request->validate([
            'exit_date' => ['nullable', 'date'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);

        $exitDate = Carbon::parse($data['exit_date'] ?? ($contract->end_date ?? Carbon::today()))->toDateString();
        $employee = $contract->employee;

        DB::transaction(function () use ($contract, $employee, $exitDate, $data, $request) {
            EmployeeExit::create([
                'employee_id' => $employee->id,
                'full_name' => $employee->full_name,
                'position_id' => $employee->position_id,
                'department_id' => $employee->department_id,
                'site_id' => $employee->site_id,
                'entry_date' => $employee->entry_date,
                'exit_date' => $exitDate,
                // Starts with "STC" so Pointage's cancel (✕) finds and reverts it too.
                'reason' => $this->stcReason($data['reason'] ?? null),
                'created_by' => $request->user()->id,
            ]);

            $employee->update(['status' => 'sorti', 'exit_date' => $exitDate]);

            Assignment::where('employee_id', $employee->id)
                ->where('is_current', true)
                ->update(['is_current' => false, 'end_date' => $exitDate]);

            $contract->update(['outcome' => 'stc', 'outcome_date' => $exitDate]);

            // Same day shows "Absent - STC" in Pointage, exactly as if the STC
            // had been keyed there (cancelling it there undoes everything).
            Attendance::updateOrCreate(
                ['employee_id' => $employee->id, 'date' => $exitDate],
                [
                    'site_id' => $employee->site_id,
                    'status' => 'absent',
                    'absence_cause' => 'stc',
                    'description' => 'Fin de contrat',
                    'created_by' => $request->user()->id,
                ]
            );
        });

        AuditLogger::log('contract.stc', "Sortie (STC) en fin de contrat — {$employee->full_name} le ".Carbon::parse($exitDate)->format('d/m/Y'), $employee->site_id, $contract);

        return $this->loadFor($contract->refresh());
    }

    protected function stcReason(?string $reason): string
    {
        $reason = trim((string) $reason);
        if ($reason === '' || $reason === 'STC — fin de contrat') {
            return 'STC — fin de contrat';
        }

        return str_starts_with(mb_strtoupper($reason), 'STC') ? $reason : "STC — {$reason}";
    }

    protected function ensureOpenCdd(Request $request, Contract $contract): void
    {
        $this->ensureSiteAccess($request, $contract->employee->site_id);

        if ($contract->outcome) {
            abort(422, 'Ce contrat est déjà clôturé.');
        }
        if ($contract->type !== 'cdd') {
            abort(422, 'Seul un CDD peut être renouvelé ou passé en CDI.');
        }
        if ($contract->employee->status === 'sorti') {
            abort(422, "{$contract->employee->full_name} est sorti(e).");
        }
    }

    protected function shape(array $data): array
    {
        $cdd = $data['type'] === 'cdd';

        return [
            'type' => $data['type'],
            'start_date' => Carbon::parse($data['start_date'])->toDateString(),
            'duration_months' => $cdd ? (int) $data['duration_months'] : null,
            'end_date' => $cdd ? Contract::endFor($data['start_date'], (int) $data['duration_months'])->toDateString() : null,
            'notes' => $data['notes'] ?? null,
        ];
    }

    protected function label(Contract $contract): string
    {
        return $contract->type === 'cdi' ? 'CDI' : "CDD {$contract->duration_months} mois";
    }

    protected function loadFor(Contract $contract): Contract
    {
        return $contract->load(['employee:id,full_name,status,site_id,position_id,entry_date', 'employee.site:id,name', 'employee.position:id,name']);
    }
}
