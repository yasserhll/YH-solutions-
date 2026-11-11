<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CIN and permis de conduire expiry dates on the employee (entered with the
 * Entrée, followed in Contrats → CIN / Permis). Only adds nullable columns;
 * existing rows are left untouched.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            if (! Schema::hasColumn('employees', 'cin_expiry_date')) {
                $table->date('cin_expiry_date')->nullable()->after('phone');
            }
            if (! Schema::hasColumn('employees', 'is_driver')) {
                $table->boolean('is_driver')->default(false)->after('cin_expiry_date');
            }
            if (! Schema::hasColumn('employees', 'license_expiry_date')) {
                $table->date('license_expiry_date')->nullable()->after('is_driver');
            }
            if (! Schema::hasColumn('employees', 'driver_opt_out')) {
                // Set when "Conducteur de camion" is unticked for a "Chauffeur…" fonction.
                $table->boolean('driver_opt_out')->default(false)->after('license_expiry_date');
            }
            // Which alert (bientot / expire) was already pushed for each document, like contracts.notified_state.
            if (! Schema::hasColumn('employees', 'cin_notified_state')) {
                $table->string('cin_notified_state', 20)->nullable()->after('driver_opt_out');
            }
            if (! Schema::hasColumn('employees', 'license_notified_state')) {
                $table->string('license_notified_state', 20)->nullable()->after('cin_notified_state');
            }
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            foreach (['license_notified_state', 'cin_notified_state', 'driver_opt_out', 'license_expiry_date', 'is_driver', 'cin_expiry_date'] as $column) {
                if (Schema::hasColumn('employees', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
