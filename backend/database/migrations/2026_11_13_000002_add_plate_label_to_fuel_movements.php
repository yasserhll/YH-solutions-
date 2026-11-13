<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add-only: the "Immatriculation" text exactly as the citerne sheet shows it
 * ("PELLE 350 GC", "D55 CADEX"…), kept at import so Détail citernes and its
 * export read like the original file. Null for older imports / bons: the
 * vehicle's matricule is shown instead.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('fuel_movements', 'plate_label')) {
            Schema::table('fuel_movements', function (Blueprint $table) {
                $table->string('plate_label', 60)->nullable()->after('vehicle_code');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('fuel_movements', 'plate_label')) {
            Schema::table('fuel_movements', fn (Blueprint $table) => $table->dropColumn('plate_label'));
        }
    }
};
