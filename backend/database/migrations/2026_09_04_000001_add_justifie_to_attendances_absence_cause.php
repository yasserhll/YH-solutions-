<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE attendances MODIFY absence_cause ENUM('maladie', 'autorisee', 'non_autorisee', 'justifie', 'conge') NULL");
    }

    public function down(): void
    {
        DB::statement("UPDATE attendances SET absence_cause = 'autorisee' WHERE absence_cause = 'justifie'");
        DB::statement("ALTER TABLE attendances MODIFY absence_cause ENUM('maladie', 'autorisee', 'non_autorisee', 'conge') NULL");
    }
};
