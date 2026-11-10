<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Device notifications (Web Push): one row per browser / installed PWA that
 * turned on "Notifications sur cet appareil", the VAPID keys (generated once,
 * stored here so no .env change is needed) and, per contract, the last alert
 * state already pushed (so each alert is sent once). Additive only.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('push_subscriptions')) {
            Schema::create('push_subscriptions', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->text('endpoint');
                $table->char('endpoint_hash', 64)->unique();
                $table->string('public_key');
                $table->string('auth_token');
                $table->string('content_encoding', 20)->default('aes128gcm');
                $table->string('user_agent')->nullable();
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('app_settings')) {
            Schema::create('app_settings', function (Blueprint $table) {
                $table->string('key')->primary();
                $table->text('value')->nullable();
                $table->timestamps();
            });
        }

        if (! Schema::hasColumn('contracts', 'notified_state')) {
            Schema::table('contracts', function (Blueprint $table) {
                $table->string('notified_state', 20)->nullable()->after('auto_cdi');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('contracts', 'notified_state')) {
            Schema::table('contracts', fn (Blueprint $table) => $table->dropColumn('notified_state'));
        }
        Schema::dropIfExists('push_subscriptions');
        // app_settings is kept on purpose: it holds the VAPID keys, and new
        // keys would silently break every device already subscribed.
    }
};
