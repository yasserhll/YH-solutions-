<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * sites.truck_unit: counter unit of the site's camions (codes D…). Louta's
 * camions are Sinotruk, hour-metered (L/h = litres / parcours); every other
 * site runs MAN trucks on a km odometer (L/100 km = litres / parcours × 100).
 */
return new class extends Migration
{
    public function up(): void
    {
        // Guarded: a first production run added the column, then crashed on the
        // recalculate() below that needed fuel_vehicles.brand (next migration).
        if (! Schema::hasColumn('sites', 'truck_unit')) {
            Schema::table('sites', function (Blueprint $table) {
                $table->enum('truck_unit', ['km', 'h'])->default('km')->after('slug');
            });
        }

        DB::table('sites')->where('slug', 'louta')->update(['truck_unit' => 'h']);

        // The Global is rebuilt by the next migration, once fuel_vehicles.brand
        // exists: recalculate() reads it.
    }

    public function down(): void
    {
        Schema::table('sites', function (Blueprint $table) {
            $table->dropColumn('truck_unit');
        });
    }
};
