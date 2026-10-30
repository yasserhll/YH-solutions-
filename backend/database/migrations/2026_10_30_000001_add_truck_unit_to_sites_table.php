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
        Schema::table('sites', function (Blueprint $table) {
            $table->enum('truck_unit', ['km', 'h'])->default('km')->after('slug');
        });

        DB::table('sites')->where('slug', 'louta')->update(['truck_unit' => 'h']);

        // Existing Global rows of the km sites were computed as L/h: rebuild them.
        app(\App\Services\FuelConsumptionService::class)->recalculate();
    }

    public function down(): void
    {
        Schema::table('sites', function (Blueprint $table) {
            $table->dropColumn('truck_unit');
        });
    }
};
