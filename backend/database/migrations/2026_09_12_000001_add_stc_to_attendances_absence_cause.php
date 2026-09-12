<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE attendances MODIFY absence_cause ENUM('maladie', 'autorisee', 'non_autorisee', 'conge', 'mise_a_pied', 'stc') NULL");
    }

    public function down(): void
    {
        DB::statement("UPDATE attendances SET absence_cause = NULL WHERE absence_cause = 'stc'");
        DB::statement("ALTER TABLE attendances MODIFY absence_cause ENUM('maladie', 'autorisee', 'non_autorisee', 'conge', 'mise_a_pied') NULL");
    }
};
