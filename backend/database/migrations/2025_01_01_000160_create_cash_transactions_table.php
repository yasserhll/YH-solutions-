<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cash_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('cash_account_id')->constrained('cash_accounts')->cascadeOnDelete();
            // Nullable: a "entry" (recharge) funds the shared caisse and is
            // not tied to one site, exactly like the "Entree" rows with no
            // site in the reference Excel's Admin sheet. An "expense" always
            // has a site — it's a specific site's declared purchase.
            $table->foreignId('site_id')->nullable()->constrained('sites')->cascadeOnDelete();
            $table->enum('type', ['expense', 'entry'])->default('expense');
            $table->date('date');
            $table->string('beneficiary')->nullable();
            $table->text('description')->nullable();
            $table->decimal('amount', 12, 2);
            $table->decimal('running_balance', 12, 2);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['site_id', 'date']);
            $table->index('type');
            $table->index('beneficiary');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cash_transactions');
    }
};
