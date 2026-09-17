<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Mirrors the paper "RAPPORT JOURNALIER HSE" form (réf. RJ-HSE-TRP-02) field
 * for field, filed daily by an `hse` user for their site — see HseReportController.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hse_reports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->date('report_date');

            $table->text('activities');
            $table->unsignedInteger('spa_count')->default(0);
            $table->text('topics_covered')->nullable();
            $table->unsignedInteger('participants_count')->default(0);
            $table->unsignedInteger('sanctions_count')->default(0);
            $table->unsignedInteger('dangerous_situations_count')->default(0);
            $table->text('equipment_inspected')->nullable();
            $table->enum('general_state', ['conforme', 'non_conforme']);
            $table->text('sor_notes')->nullable();
            $table->text('corrective_actions')->nullable();

            $table->unsignedInteger('incidents_count')->default(0);
            $table->string('incidents_comment')->nullable();
            $table->unsignedInteger('accidents_count')->default(0);
            $table->string('accidents_comment')->nullable();
            $table->unsignedInteger('environmental_impact_count')->default(0);
            $table->string('environmental_impact_comment')->nullable();

            $table->unsignedInteger('shift_headcount')->nullable();
            $table->decimal('hours_worked', 6, 2)->nullable();
            $table->decimal('sensitization_participation_rate', 5, 2)->nullable();
            $table->decimal('corrective_actions_closure_rate', 5, 2)->nullable();
            $table->unsignedInteger('non_conformities_count')->default(0);
            $table->unsignedInteger('inductions_count')->default(0);
            $table->unsignedInteger('audits_count')->default(0);
            $table->unsignedInteger('evacuation_drills_count')->default(0);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['site_id', 'report_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hse_reports');
    }
};
