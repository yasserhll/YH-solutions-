<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * fuel_vehicles.brand: a camion's make decides its counter (FuelVehicle::BRAND_UNITS):
 * Sinotruk = hour meter (L/h, like the engins), MAN / Renault = km odometer
 * (L/100 km). Empty = the site's default (sites.truck_unit).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_vehicles', function (Blueprint $table) {
            $table->enum('brand', ['sinotruk', 'man', 'renault'])->nullable()->after('type');
        });
    }

    public function down(): void
    {
        Schema::table('fuel_vehicles', function (Blueprint $table) {
            $table->dropColumn('brand');
        });
    }
};
