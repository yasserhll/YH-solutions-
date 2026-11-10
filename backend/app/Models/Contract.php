<?php

namespace App\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

/**
 * An employee's work contract. Every Entrée signs a 3-month CDD
 * (EntryController); when it ends it is renewed (a new CDD), turned into a
 * CDI, or closed by a sortie (STC) — ContractController's actions. The
 * contract that closed records how (`outcome`), so an employee's contracts
 * read as a history; the one with `outcome` null is the current one.
 */
class Contract extends Model
{
    public const DEFAULT_MONTHS = 3;

    /** "Presque terminé" (orange) this many days before the end; red once ended. */
    public const ALERT_DAYS = 10;

    protected $fillable = [
        'employee_id', 'site_id', 'type', 'start_date', 'end_date', 'duration_months', 'rank_override',
        'outcome', 'outcome_date', 'auto_cdi', 'notes', 'created_by',
    ];

    protected $appends = ['state', 'days_left', 'cdd_number'];

    protected function casts(): array
    {
        return [
            'start_date' => 'date',
            'end_date' => 'date',
            'outcome_date' => 'date',
            'duration_months' => 'integer',
            'rank_override' => 'integer',
            'auto_cdi' => 'boolean',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    /** Last day of a contract of $months months starting $start (01/09 + 3 mois → 30/11). */
    public static function endFor(Carbon|string $start, int $months): Carbon
    {
        return Carbon::parse($start)->addMonthsNoOverflow($months)->subDay();
    }

    /** A new entry's first contract: a 3-month CDD from the entry date. */
    public static function openFirstCdd(Employee $employee, Carbon|string $startDate, ?int $userId): self
    {
        return self::create([
            'employee_id' => $employee->id,
            'site_id' => $employee->site_id,
            'type' => 'cdd',
            'start_date' => Carbon::parse($startDate)->toDateString(),
            'end_date' => self::endFor($startDate, self::DEFAULT_MONTHS)->toDateString(),
            'duration_months' => self::DEFAULT_MONTHS,
            'created_by' => $userId,
        ]);
    }

    /**
     * An employee left (STC from Pointage, a Sortie in Entrées/Sorties, or
     * Contrats → Sortie STC): their current contract is closed as "stc" on
     * that date. RevertsEmployeeDeparture reopens it when the departure is
     * cancelled from any of those places.
     */
    public static function closeForDeparture(int $employeeId, string $exitDate): void
    {
        self::where('employee_id', $employeeId)
            ->whereNull('outcome')
            ->update(['outcome' => 'stc', 'outcome_date' => $exitDate]);
    }

    /**
     * Number of a CDD (1 = 1er CDD, 2 = 2ème…): the one picked by hand in
     * Modifier (`rank_override`) or else its rank among the employee's CDDs by
     * start date. Lists read it from the `cdd_rank` column selected by
     * `scopeWithCddNumber()`; computed with one query otherwise. Null for a CDI.
     * It drives the automation: a 1st CDD is manual, a 2nd+ auto-turns CDI.
     */
    public function getCddNumberAttribute(): ?int
    {
        if ($this->type !== 'cdd') {
            return null;
        }
        if ($this->rank_override) {
            return $this->rank_override;
        }
        if (array_key_exists('cdd_rank', $this->attributes)) {
            return (int) $this->attributes['cdd_rank'];
        }

        return $this->computedCddNumber();
    }

    /** The rank from the history alone, ignoring any hand-picked number. */
    public function computedCddNumber(): int
    {
        return self::where('employee_id', $this->employee_id)->where('type', 'cdd')
            ->where(fn ($q) => $q->whereDate('start_date', '<', $this->start_date)
                ->orWhere(fn ($q) => $q->whereDate('start_date', $this->start_date)->where('id', '<=', $this->id)))
            ->count();
    }

    /** Adds `cdd_rank` (see getCddNumberAttribute) in the same query as the list. */
    public function scopeWithCddNumber(Builder $query): Builder
    {
        [$sql, $bindings] = self::cddRankSql();

        return $query->select('contracts.*')->selectRaw("{$sql} as cdd_rank", $bindings);
    }

    /**
     * Only CDDs with that number (1er / 2ème / 3ème…); with $orMore, that
     * number or higher ("3ème CDD et plus"). Same expression as cdd_rank.
     */
    public function scopeWithCddRank(Builder $query, int $rank, bool $orMore = false): Builder
    {
        [$sql, $bindings] = self::cddRankSql();

        return $query->where('contracts.type', 'cdd')
            ->whereRaw("{$sql} ".($orMore ? '>=' : '=').' ?', [...$bindings, $rank]);
    }

    /** SQL for a CDD's number: the hand-picked one, else its rank in the history. */
    protected static function cddRankSql(): array
    {
        $history = self::query()->from('contracts as c2')->selectRaw('count(*)')
            ->whereColumn('c2.employee_id', 'contracts.employee_id')
            ->where('c2.type', 'cdd')
            ->where(fn ($q) => $q->whereColumn('c2.start_date', '<', 'contracts.start_date')
                ->orWhere(fn ($q) => $q->whereColumn('c2.start_date', 'contracts.start_date')->whereColumn('c2.id', '<=', 'contracts.id')));

        return ['COALESCE(contracts.rank_override, ('.$history->toSql().'))', $history->getBindings()];
    }

    /**
     * User's rule: the 1st CDD's end is always a manual decision, but a 2nd
     * (or later) CDD becomes a CDI by itself the day after it ends — unless
     * `auto_cdi` was switched off on it (Modifier, or automatically when an
     * automatic CDI is deleted, so it isn't redone straight away). Runs
     * lazily from ContractController (the top-bar bell hits /contracts/summary
     * on every page) and daily via `contrats:cdi-auto`, so it never depends on
     * a cron being configured. Returns how many contracts were promoted.
     */
    public static function promoteDueToCdi(): int
    {
        $due = self::query()
            ->whereNull('outcome')
            ->where('type', 'cdd')
            ->where('auto_cdi', true)
            ->whereDate('end_date', '<', Carbon::today()->toDateString())
            ->whereHas('employee', fn ($e) => $e->where('status', 'actif'))
            // 2nd+ CDD: picked by hand, or (no hand-picked number) an earlier CDD exists.
            ->where(fn ($rank) => $rank->where('rank_override', '>=', 2)
                ->orWhere(fn ($r) => $r->whereNull('rank_override')
                    ->whereExists(fn ($q) => $q->from('contracts as prev')
                        ->whereColumn('prev.employee_id', 'contracts.employee_id')
                        ->where('prev.type', 'cdd')
                        ->where(fn ($w) => $w->whereColumn('prev.start_date', '<', 'contracts.start_date')
                            ->orWhere(fn ($w) => $w->whereColumn('prev.start_date', 'contracts.start_date')->whereColumn('prev.id', '<', 'contracts.id'))))))
            ->with('employee:id,full_name,site_id')
            ->get();

        foreach ($due as $contract) {
            DB::transaction(function () use ($contract) {
                $start = $contract->end_date->copy()->addDay();
                $contract->update(['outcome' => 'cdi', 'outcome_date' => $start->toDateString()]);
                $cdi = self::create([
                    'employee_id' => $contract->employee_id,
                    'site_id' => $contract->employee->site_id,
                    'type' => 'cdi',
                    'start_date' => $start->toDateString(),
                    'notes' => 'CDI automatique à la fin du '.$contract->cdd_number.'ème CDD',
                ]);

                \App\Services\AuditLogger::log(
                    'contract.cdi',
                    "Passage automatique en CDI — {$contract->employee->full_name} à partir du {$start->format('d/m/Y')}",
                    $contract->employee->site_id,
                    $cdi
                );
            });
        }

        return $due->count();
    }

    /** Days until the end date (negative once ended); null for a CDI or a closed contract. */
    public function getDaysLeftAttribute(): ?int
    {
        if ($this->type !== 'cdd' || $this->outcome || ! $this->end_date) {
            return null;
        }

        return (int) Carbon::today()->diffInDays($this->end_date, false);
    }

    /**
     * en_cours | bientot (≤ ALERT_DAYS left) | termine (ended, nothing decided)
     * | cdi | sorti (left by another route) | renouvele / stc (closed contracts).
     */
    public function getStateAttribute(): string
    {
        if ($this->outcome) {
            return $this->outcome === 'cdi' ? 'passe_cdi' : $this->outcome;
        }
        if ($this->type === 'cdi') {
            return 'cdi';
        }
        if ($this->employee?->status === 'sorti') {
            return 'sorti';
        }

        $left = $this->days_left;

        return $left < 0 ? 'termine' : ($left <= self::ALERT_DAYS ? 'bientot' : 'en_cours');
    }

    /** SQL twin of the states above, for list filters and the alert counts. */
    public function scopeInState(Builder $query, string $state): Builder
    {
        $today = Carbon::today()->toDateString();
        $alert = Carbon::today()->addDays(self::ALERT_DAYS)->toDateString();
        $openCdd = fn (Builder $q) => $q->whereNull('outcome')->where('type', 'cdd')
            ->whereHas('employee', fn ($e) => $e->where('status', '!=', 'sorti'));

        return match ($state) {
            'en_cours' => $openCdd($query)->whereDate('end_date', '>', $alert),
            'bientot' => $openCdd($query)->whereDate('end_date', '>=', $today)->whereDate('end_date', '<=', $alert),
            'termine' => $openCdd($query)->whereDate('end_date', '<', $today),
            'a_traiter' => $openCdd($query)->whereDate('end_date', '<=', $alert),
            'cdi' => $query->whereNull('outcome')->where('type', 'cdi'),
            'historique' => $query->whereNotNull('outcome'),
            default => $query->whereNull('outcome'), // every current contract
        };
    }
}
