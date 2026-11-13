<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bons carburant typed by the pompiste (the paper "BON" of each refuel):
 * a bon IS a SORTIE line of its citerne (`fuel_movements`, origin = 'bon'),
 * so the Global / Rapport read it like any imported line. Add-only:
 * - origin enum widened with 'bon' (never narrowed);
 * - the bon's own fields that no Excel column had (société, conducteur,
 *   CIN, pompiste, who typed it);
 * - fuel_bon_attachments: the photos / files proving the refuel.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE fuel_movements MODIFY origin ENUM('import','manual','bon') NOT NULL DEFAULT 'import'");

        Schema::table('fuel_movements', function (Blueprint $table) {
            if (! Schema::hasColumn('fuel_movements', 'company')) {
                $table->string('company', 120)->nullable()->after('bon_number');
                $table->string('driver_name', 120)->nullable()->after('company');
                $table->string('driver_cin', 30)->nullable()->after('driver_name');
                $table->string('pompiste_name', 120)->nullable()->after('driver_cin');
                $table->foreignId('created_by')->nullable()->after('edited')->constrained('users')->nullOnDelete();
                $table->timestamp('created_at')->nullable()->after('created_by');
                $table->index(['fuel_tank_id', 'bon_number']);
            }
        });

        if (! Schema::hasTable('fuel_bon_attachments')) {
            Schema::create('fuel_bon_attachments', function (Blueprint $table) {
                $table->id();
                $table->foreignId('fuel_movement_id')->constrained('fuel_movements')->cascadeOnDelete();
                $table->string('path');
                $table->string('original_name');
                $table->string('mime', 100);
                $table->unsignedInteger('size');
                $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_bon_attachments');
        Schema::table('fuel_movements', function (Blueprint $table) {
            $table->dropIndex(['fuel_tank_id', 'bon_number']);
            $table->dropConstrainedForeignId('created_by');
            $table->dropColumn(['company', 'driver_name', 'driver_cin', 'pompiste_name', 'created_at']);
        });
    }
};
