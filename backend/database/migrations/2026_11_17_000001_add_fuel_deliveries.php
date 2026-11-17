<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Entrées carburant": every delivery of gasoil into a citerne, with its
 * price — typed by the pompiste from the supplier's BON DE LIVRAISON, or
 * imported from the company's "INVENTAIRE" workbook (sheets "Citernes
 * Fixes" / "Citerne mobile"). Add-only:
 * - fuel_movements.origin widened with 'livraison' (a delivery typed in the
 *   app is also the ENTREE line of its citerne, so Détail citernes shows it);
 * - fuel_deliveries: the delivery itself (quantities, prices, invoice…).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE fuel_movements MODIFY origin ENUM('import','manual','bon','livraison') NOT NULL DEFAULT 'import'");

        if (! Schema::hasTable('fuel_deliveries')) {
            Schema::create('fuel_deliveries', function (Blueprint $table) {
                $table->id();
                $table->foreignId('site_id')->constrained()->cascadeOnDelete();
                $table->foreignId('fuel_tank_id')->nullable()->constrained('fuel_tanks')->nullOnDelete();
                // The citerne as written in the inventory ("BOUCHANE 1", "84246A55").
                $table->string('tank_label', 120)->nullable();
                $table->enum('kind', ['fixe', 'mobile'])->default('fixe');
                $table->date('date');
                $table->time('time')->nullable();
                $table->decimal('quantity', 12, 2);
                $table->decimal('unit_price', 12, 6)->nullable();
                $table->decimal('amount', 14, 2)->nullable();
                $table->string('supplier', 120)->nullable();
                $table->string('order_number', 60)->nullable();
                $table->string('delivery_note', 60)->nullable();
                $table->string('invoice_number', 60)->nullable();
                $table->boolean('invoice_received')->default(false);
                $table->decimal('gauge_before_cm', 8, 2)->nullable();
                $table->decimal('gauge_before_l', 12, 2)->nullable();
                $table->decimal('gauge_after_cm', 8, 2)->nullable();
                $table->decimal('gauge_after_l', 12, 2)->nullable();
                $table->decimal('serie', 14, 2)->nullable();
                $table->string('truck', 60)->nullable();
                $table->string('driver_name', 120)->nullable();
                $table->string('pompiste_name', 120)->nullable();
                $table->string('remark', 255)->nullable();
                $table->enum('origin', ['app', 'import'])->default('app');
                // Stable key of an imported line, so a re-import updates instead of duplicating.
                $table->string('import_key', 64)->nullable()->unique();
                // The citerne's ENTREE line created for a delivery typed in the app.
                $table->foreignId('fuel_movement_id')->nullable()->constrained('fuel_movements')->nullOnDelete();
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                $table->index(['site_id', 'date']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_deliveries');
    }
};
