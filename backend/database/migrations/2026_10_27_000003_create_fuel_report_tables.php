<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Consommation > Rapport (the daily "CONSOMMATION JOURNALIERE DE GASOIL"):
 * - fuel_assignments: the site's "LISTE D'AFFECTATION" — which drivers
 *   (équipe 1 / équipe 2) run each camion/engin, imported from Excel or typed;
 * - fuel_report_lines: what was changed by hand for ONE day of the report
 *   (a replacement driver, the day's activité) — the rest of the report is
 *   computed from the imported citernes;
 * - fuel_vehicles.unit: per-vehicle override of the counter unit (a D77
 *   water truck has a km odometer although D-camions are hour-metered).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_vehicles', function (Blueprint $table) {
            $table->enum('unit', ['km', 'h'])->nullable()->after('type');
        });

        Schema::create('fuel_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->string('code', 60);
            $table->string('label', 80)->nullable();
            $table->enum('category', ['camion', 'engin']);
            $table->string('driver_1', 120)->nullable();
            $table->string('driver_2', 120)->nullable();
            $table->string('replacements')->nullable();
            $table->string('activity', 120)->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['site_id', 'code']);
        });

        Schema::create('fuel_report_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->date('date');
            $table->string('vehicle_code', 60);
            $table->string('driver_1', 120)->nullable();
            $table->string('driver_2', 120)->nullable();
            $table->string('activity', 120)->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['site_id', 'date', 'vehicle_code']);
            $table->index(['site_id', 'vehicle_code', 'date']);
        });

        // Old road trucks / water trucks keyed with a D code but driven by a
        // km odometer (counters in the hundreds of thousands): seen in the
        // company's own daily report, where D77's "%" is litres per km.
        DB::table('fuel_vehicles')->whereIn('code', ['D11', 'D18', 'D24', 'D29', 'D43', 'D66', 'D75', 'D77', 'D104'])->update(['unit' => 'km']);
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_report_lines');
        Schema::dropIfExists('fuel_assignments');
        Schema::table('fuel_vehicles', function (Blueprint $table) {
            $table->dropColumn('unit');
        });
    }
};
