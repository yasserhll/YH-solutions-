<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cash_transactions', function (Blueprint $table) {
            // Nullable: an "entry" (recharge of the shared master caisse) never
            // touches a site's own balance. "transfer" (credit) and "expense"
            // (debit) always have one, maintained by CashLedgerService::recalculate().
            $table->decimal('site_running_balance', 12, 2)->nullable()->after('running_balance');
        });
    }

    public function down(): void
    {
        Schema::table('cash_transactions', function (Blueprint $table) {
            $table->dropColumn('site_running_balance');
        });
    }
};
