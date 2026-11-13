<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Matériel shows the "CODE PARC" exactly as written in the company's
 * workbook ("D66 ARR", "TRSP", "DACIA", "PORTE- CHAR …"), in the file's
 * order. `fuel_vehicles.code` stays the code keyed at the pump (what
 * Consommation matches on), so the two are kept apart. Nullable, add-only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_vehicles', function (Blueprint $table) {
            if (! Schema::hasColumn('fuel_vehicles', 'fleet_code')) {
                $table->string('fleet_code', 120)->nullable()->after('code');
            }
            if (! Schema::hasColumn('fuel_vehicles', 'sort_order')) {
                $table->unsignedInteger('sort_order')->nullable()->after('notes');
            }
        });
    }

    public function down(): void
    {
        Schema::table('fuel_vehicles', function (Blueprint $table) {
            foreach (['fleet_code', 'sort_order'] as $column) {
                if (Schema::hasColumn('fuel_vehicles', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
