<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A multi-site responsable no longer works on one "active" site at a time —
 * every site assigned to them (site_user pivot) is usable simultaneously,
 * with an explicit Site selector on each create and an optional view filter
 * (same mechanism a SuperAdmin already uses, just restricted to their own
 * assigned sites). See InteractsWithSites — active_site_id is no longer
 * read anywhere, so the column is dropped rather than left unused.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['active_site_id']);
            $table->dropColumn('active_site_id');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('active_site_id')->nullable()->after('role')->constrained('sites')->nullOnDelete();
        });
    }
};
