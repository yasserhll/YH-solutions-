<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The "Historique" page (Paramètres) needs to list/filter audit rows by site
 * without joining out to every possible auditable model, and needs a
 * ready-to-display French sentence rather than reconstructing one from
 * old_values/new_values at read time — so both are written once, at the
 * point of the action, by AuditLogger::log().
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->foreignId('site_id')->nullable()->after('user_id')->constrained('sites')->nullOnDelete();
            $table->string('description')->after('action');
        });

        // Plain ALTER instead of Blueprint::change() — that needs doctrine/dbal,
        // which isn't installed. A deleted record's model is still in memory
        // when AuditLogger::log() runs (Eloquent doesn't null out attributes
        // after ->delete()), so this is only exercised by a handful of
        // destroy() calls that log without a model at all.
        DB::statement('ALTER TABLE audit_logs MODIFY auditable_id BIGINT UNSIGNED NULL');
    }

    public function down(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->dropConstrainedForeignId('site_id');
            $table->dropColumn('description');
        });
    }
};
