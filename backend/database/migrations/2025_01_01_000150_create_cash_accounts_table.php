<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A single, company-wide cash box — matching the reference Excel's
     * "Admin" sheet, which holds one shared solde initial / reste across all
     * 4 sites rather than one balance per site. There is only ever one row
     * in this table.
     */
    public function up(): void
    {
        Schema::create('cash_accounts', function (Blueprint $table) {
            $table->id();
            $table->decimal('initial_balance', 12, 2)->default(0);
            $table->boolean('allow_negative_balance')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cash_accounts');
    }
};
