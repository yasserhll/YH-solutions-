<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per employee per calendar month — the derived ledger
 * App\Services\OvertimeLedgerService recomputes from overtime_entries,
 * exactly like CashLedgerService recomputes cash_transactions' running
 * balances: never hand-edited, always regenerated on every entry
 * create/update/delete so it can never drift from the raw declarations.
 *
 * 8 overtime hours = 1 payable day (`days_earned`); whatever doesn't divide
 * evenly (`remaining_hours`, always < 8) carries into the NEXT month's
 * `carried_hours` — no hour is ever dropped at a month boundary.
 *
 * There is deliberately no stored "paid" flag: a month's days are
 * considered paid automatically the moment the calendar moves past that
 * month (see OvertimeMonth::isPaid()) — computed fresh on every read from
 * `month` vs. today, never persisted, so it can never go stale the way a
 * manually-toggled flag could.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('overtime_months', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->date('month'); // always the 1st of the month
            $table->decimal('carried_hours', 6, 2)->default(0);
            $table->decimal('declared_hours', 6, 2)->default(0);
            $table->decimal('total_hours', 6, 2)->default(0);
            $table->unsignedInteger('days_earned')->default(0);
            $table->decimal('remaining_hours', 4, 2)->default(0);
            $table->timestamps();

            $table->unique(['employee_id', 'month']);
            $table->index(['site_id', 'month']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('overtime_months');
    }
};
