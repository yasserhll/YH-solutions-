<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * users.modules: the sessions (modules) a SuperAdmin chose for this account,
 * e.g. a responsable without Caisse. Null = the role's default set
 * (User::ROLE_MODULES), so every existing account keeps exactly its access.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'modules')) {
            Schema::table('users', function (Blueprint $table) {
                $table->json('modules')->nullable()->after('role');
            });
        }
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('modules');
        });
    }
};
