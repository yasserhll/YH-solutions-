<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Pompiste" accounts and the Matériel session:
 * - users.role gains `pompiste` (the enum is only WIDENED, every existing
 *   account keeps its role);
 * - fuel_vehicles (the company's vehicle list, already used by Consommation
 *   → Matriculation / Global) gains a site, the chassis number, a status
 *   and notes. Only nullable / defaulted columns: existing rows are kept.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() === 'mysql') {
            DB::statement("ALTER TABLE users MODIFY role ENUM('superadmin', 'responsable', 'hse', 'responsable_hse', 'pompiste') NOT NULL DEFAULT 'responsable'");
        }

        Schema::table('fuel_vehicles', function (Blueprint $table) {
            if (! Schema::hasColumn('fuel_vehicles', 'site_id')) {
                $table->foreignId('site_id')->nullable()->after('id')->constrained('sites')->nullOnDelete();
            }
            if (! Schema::hasColumn('fuel_vehicles', 'chassis_number')) {
                $table->string('chassis_number', 80)->nullable()->after('matricule');
            }
            if (! Schema::hasColumn('fuel_vehicles', 'status')) {
                $table->string('status', 20)->default('en_service')->after('unit');
            }
            if (! Schema::hasColumn('fuel_vehicles', 'notes')) {
                $table->string('notes')->nullable()->after('status');
            }
        });
    }

    public function down(): void
    {
        Schema::table('fuel_vehicles', function (Blueprint $table) {
            if (Schema::hasColumn('fuel_vehicles', 'site_id')) {
                $table->dropConstrainedForeignId('site_id');
            }
            foreach (['chassis_number', 'status', 'notes'] as $column) {
                if (Schema::hasColumn('fuel_vehicles', $column)) {
                    $table->dropColumn($column);
                }
            }
        });

        if (DB::getDriverName() === 'mysql') {
            DB::table('users')->where('role', 'pompiste')->update(['role' => 'responsable']);
            DB::statement("ALTER TABLE users MODIFY role ENUM('superadmin', 'responsable', 'hse', 'responsable_hse') NOT NULL DEFAULT 'responsable'");
        }
    }
};
