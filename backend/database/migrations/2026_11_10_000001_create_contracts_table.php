<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Contrats: every new entry signs a 3-month CDD; at its end it is renewed
 * (another CDD), turned into a CDI, or closed by a sortie (STC).
 *
 * Only ADDS a table. Existing employees get their contracts from
 * 2026_11_10_000002_backfill_contracts.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('contracts')) {
            Schema::create('contracts', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
                $table->foreignId('site_id')->nullable()->constrained()->nullOnDelete();
                $table->enum('type', ['cdd', 'cdi'])->default('cdd');
                $table->date('start_date');
                $table->date('end_date')->nullable(); // null for a CDI
                $table->unsignedSmallInteger('duration_months')->nullable();
                // What closed this contract: renewed, turned into a CDI, or a sortie (STC). Null = still the current one.
                $table->enum('outcome', ['renouvele', 'cdi', 'stc'])->nullable();
                $table->date('outcome_date')->nullable();
                $table->text('notes')->nullable();
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();

                $table->index(['employee_id', 'start_date']);
                $table->index(['outcome', 'end_date']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('contracts');
    }
};
