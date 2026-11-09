<?php

use App\Models\CashAccount;
use App\Services\CashLedgerService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Each site keeps its own caisse: sites sharing a responsable are no longer
 * pooled automatically. A SuperAdmin can instead show one account its sites
 * as one combined caisse (`cash_merged`, display only). The ledger's cached
 * site_running_balance was computed per pool, so it is recomputed per site.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'cash_merged')) {
            Schema::table('users', function (Blueprint $table) {
                $table->boolean('cash_merged')->default(false)->after('modules');
            });
        }

        if (CashAccount::query()->exists()) {
            app(CashLedgerService::class)->recalculate(CashAccount::singleton());
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'cash_merged')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('cash_merged');
            });
        }
    }
};
