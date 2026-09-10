<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('site_user', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('site_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['user_id', 'site_id']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('active_site_id')->nullable()->after('site_id')->constrained('sites')->nullOnDelete();
        });

        // Backfill: a responsable's existing single site_id becomes both
        // their one assigned site (in the new pivot) and their active site.
        $now = now();
        DB::table('users')->whereNotNull('site_id')->get(['id', 'site_id'])->each(function ($user) use ($now) {
            DB::table('site_user')->insert([
                'user_id' => $user->id,
                'site_id' => $user->site_id,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('users')->where('id', $user->id)->update(['active_site_id' => $user->site_id]);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['site_id']);
            $table->dropColumn('site_id');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('site_id')->nullable()->after('role')->constrained('sites')->nullOnDelete();
        });

        DB::table('users')->whereNotNull('active_site_id')->get(['id', 'active_site_id'])->each(function ($user) {
            DB::table('users')->where('id', $user->id)->update(['site_id' => $user->active_site_id]);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['active_site_id']);
            $table->dropColumn('active_site_id');
        });

        Schema::dropIfExists('site_user');
    }
};
