<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Two new roles, both restricted to the HSE module ONLY (see
 * app/Http/Middleware/EnsureHseModuleAccess.php and
 * app/Http/Middleware/BlockHseModuleRoles.php): `hse` files the daily HSE
 * report, `responsable_hse` reviews/controls every HSE report on their
 * assigned site(s), alongside the SuperAdmin who is unrestricted as always.
 * An actual `ENUM` column, so this needs a raw `MODIFY` rather than an
 * Eloquent schema helper — same reasoning as
 * 2026_09_08_000001_replace_justifie_with_mise_a_pied_in_attendances_absence_cause.php.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE users MODIFY role ENUM('superadmin', 'responsable', 'hse', 'responsable_hse') NOT NULL DEFAULT 'responsable'");
    }

    public function down(): void
    {
        DB::table('users')->whereIn('role', ['hse', 'responsable_hse'])->update(['role' => 'responsable']);
        DB::statement("ALTER TABLE users MODIFY role ENUM('superadmin', 'responsable') NOT NULL DEFAULT 'responsable'");
    }
};
