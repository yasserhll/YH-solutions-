<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE cash_transactions MODIFY type ENUM('expense', 'entry', 'transfer') NOT NULL DEFAULT 'expense'");
    }

    public function down(): void
    {
        DB::statement("UPDATE cash_transactions SET type = 'entry' WHERE type = 'transfer'");
        DB::statement("ALTER TABLE cash_transactions MODIFY type ENUM('expense', 'entry') NOT NULL DEFAULT 'expense'");
    }
};
