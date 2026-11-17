<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Files of a delivery (Entrées carburant): the photo of the supplier's bon de
 * livraison (kind 'bl', by the pompiste) and the invoice (kind 'facture', by
 * the responsable). On the delivery itself, so an inventory line without an
 * ENTREE of its own can carry its invoice too. Create-only.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('fuel_delivery_attachments')) {
            Schema::create('fuel_delivery_attachments', function (Blueprint $table) {
                $table->id();
                $table->foreignId('fuel_delivery_id')->constrained('fuel_deliveries')->cascadeOnDelete();
                $table->enum('kind', ['bl', 'facture'])->default('bl');
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
        Schema::dropIfExists('fuel_delivery_attachments');
    }
};
