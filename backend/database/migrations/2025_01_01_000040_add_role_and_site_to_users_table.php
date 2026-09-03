<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->enum('role', ['superadmin', 'responsable'])->default('responsable')->after('email');
            $table->foreignId('site_id')->nullable()->after('role')->constrained('sites')->nullOnDelete();
            $table->boolean('is_active')->default(true)->after('site_id');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('site_id');
            $table->dropColumn(['role', 'is_active']);
        });
    }
};
