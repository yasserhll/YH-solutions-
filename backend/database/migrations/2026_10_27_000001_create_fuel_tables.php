<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Consommation (fuel) module:
 * - fuel_vehicles: the "Matriculation" lookup (engine/truck code -> plate),
 *   company-wide, imported from matriculation.xlsx or edited by hand.
 * - fuel_tanks: one per citerne (fixed or mobile), identified by its sheet
 *   name inside the imported workbook + the site it belongs to.
 * - fuel_movements: the raw rows of every citerne sheet (an ENTREE and/or a
 *   SORTIE per Excel line). Re-importing a citerne REPLACES its rows, so the
 *   Excel file always stays the source of truth. previous_odometer/distance/
 *   consumption are derived (FuelConsumptionService::recalculate), never typed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_vehicles', function (Blueprint $table) {
            $table->id();
            $table->string('code', 60)->unique();
            $table->string('matricule', 120)->nullable();
            $table->string('type', 60)->nullable();
            $table->timestamps();
        });

        Schema::create('fuel_tanks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('last_import_file')->nullable();
            $table->timestamp('last_imported_at')->nullable();
            $table->foreignId('last_imported_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['site_id', 'name']);
        });

        Schema::create('fuel_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fuel_tank_id')->constrained('fuel_tanks')->cascadeOnDelete();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->enum('type', ['entry', 'exit']);
            $table->date('date');
            $table->time('time')->nullable();
            $table->decimal('quantity', 12, 2);
            $table->string('supplier', 120)->nullable();
            $table->string('bon_number', 60)->nullable();
            $table->string('vehicle_code', 60)->nullable();
            $table->decimal('odometer', 14, 2)->nullable();
            $table->decimal('previous_odometer', 14, 2)->nullable();
            $table->decimal('distance', 14, 2)->nullable();
            $table->decimal('consumption', 12, 4)->nullable();
            $table->decimal('serie_start', 14, 2)->nullable();
            $table->decimal('serie_end', 14, 2)->nullable();
            $table->string('remark')->nullable();
            $table->unsignedInteger('source_row')->nullable();

            $table->index(['site_id', 'type', 'date']);
            $table->index(['fuel_tank_id', 'date']);
            $table->index(['vehicle_code', 'date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_movements');
        Schema::dropIfExists('fuel_tanks');
        Schema::dropIfExists('fuel_vehicles');
    }
};
