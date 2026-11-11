<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Suivi ATIT" (accidents / incidents de travail), modelled on the company's
 * own "BILAN GLOBAL DES ACCIDENTS" workbook: Informations générales (site,
 * date, heure, shift, zone), Profil du chauffeur (nom, âge, ancienneté),
 * Matériel impliqué, Détails de l'événement, Causes, Décision prise.
 * Only creates a new table — nothing existing is touched.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('hse_accidents')) {
            return;
        }

        Schema::create('hse_accidents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('site_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20)->default('accident'); // accident | incident
            $table->date('occurred_on');
            $table->time('occurred_time')->nullable();
            $table->unsignedTinyInteger('shift')->nullable(); // 1 | 2 | 3
            $table->string('zone')->nullable();
            $table->foreignId('employee_id')->nullable()->constrained()->nullOnDelete();
            $table->string('driver_name');
            $table->unsignedTinyInteger('driver_age')->nullable();
            $table->string('driver_seniority', 60)->nullable();
            $table->string('equipment', 120)->nullable();
            $table->text('description');
            $table->text('causes')->nullable();
            $table->string('decision', 30)->nullable(); // map | repos_maladie | licenciement | avertissement | en_poste | autre
            $table->unsignedSmallInteger('decision_days')->nullable();
            $table->string('decision_note')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['site_id', 'occurred_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hse_accidents');
    }
};
