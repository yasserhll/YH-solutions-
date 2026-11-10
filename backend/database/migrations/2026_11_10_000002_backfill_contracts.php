<?php

use Carbon\Carbon;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * OLD DATA ONLY: gives every employee already "actif" when Contrats shipped
 * (and without any contract yet) the contract history their seniority
 * implies, from their entry date (user's rule):
 *   - less than 3 months  → CDD n°1, current;
 *   - 3 to 6 months       → CDD n°1 "renouvelé", CDD n°2 (3 months) current;
 *   - more than 6 months  → CDD n°1 "renouvelé", CDD n°2 "passé en CDI",
 *                           a CDI current from entry + 6 months.
 *
 * This runs ONCE, on the existing employees. New entries are never handled
 * this way: they open their 1st CDD and every renewal / CDI after that is a
 * manual decision in Contrats. Any backfilled case can be corrected there
 * too (deleting the CDI reopens the CDD n°2, the pencil changes type/dates).
 *
 * Only INSERTS rows, never touches an employee who already has a contract,
 * so running it again does nothing.
 */
return new class extends Migration
{
    private const NOTE = 'Créé automatiquement selon l’ancienneté';

    public function up(): void
    {
        $today = Carbon::today();
        $now = now();
        $end = fn (Carbon $start) => $start->copy()->addMonthsNoOverflow(3)->subDay();

        DB::table('employees')
            ->where('status', 'actif')
            ->whereNull('deleted_at')
            ->whereNotNull('entry_date')
            ->whereNotExists(fn ($q) => $q->from('contracts')->whereColumn('contracts.employee_id', 'employees.id'))
            ->orderBy('id')
            ->get(['id', 'site_id', 'entry_date'])
            ->chunk(200)
            ->each(function ($employees) use ($today, $now, $end) {
                $rows = [];

                foreach ($employees as $employee) {
                    $base = ['employee_id' => $employee->id, 'site_id' => $employee->site_id, 'notes' => self::NOTE, 'created_at' => $now, 'updated_at' => $now];

                    $start1 = Carbon::parse($employee->entry_date)->startOfDay();
                    $end1 = $end($start1);
                    if ($today->lte($end1)) {
                        $rows[] = $base + $this->cdd($start1, $end1);
                        continue;
                    }

                    $start2 = $end1->copy()->addDay();
                    $end2 = $end($start2);
                    $rows[] = $base + $this->cdd($start1, $end1, 'renouvele', $start2);
                    if ($today->lte($end2)) {
                        $rows[] = $base + $this->cdd($start2, $end2);
                        continue;
                    }

                    $cdiStart = $end2->copy()->addDay();
                    $rows[] = $base + $this->cdd($start2, $end2, 'cdi', $cdiStart);
                    $rows[] = $base + [
                        'type' => 'cdi', 'start_date' => $cdiStart->toDateString(), 'end_date' => null,
                        'duration_months' => null, 'outcome' => null, 'outcome_date' => null,
                    ];
                }

                DB::table('contracts')->insert($rows);
            });
    }

    private function cdd(Carbon $start, Carbon $end, ?string $outcome = null, ?Carbon $outcomeDate = null): array
    {
        return [
            'type' => 'cdd',
            'start_date' => $start->toDateString(),
            'end_date' => $end->toDateString(),
            'duration_months' => 3,
            'outcome' => $outcome,
            'outcome_date' => $outcomeDate?->toDateString(),
        ];
    }

    public function down(): void
    {
        // Only removes what this migration created; contracts typed or decided
        // in the app afterwards are kept.
        DB::table('contracts')->where('notes', self::NOTE)->delete();
    }
};
