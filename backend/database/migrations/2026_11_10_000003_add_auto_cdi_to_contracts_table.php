<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * - auto_cdi: a 2nd (or later) CDD turns into a CDI by itself once it ends
 *   (user's rule), unless switched off for that contract.
 * - rank_override: the CDD number (1er, 2ème, 3ème…) chosen by hand in
 *   Modifier; null = computed from the employee's contract history.
 * Only adds columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('contracts', function (Blueprint $table) {
            if (! Schema::hasColumn('contracts', 'auto_cdi')) {
                $table->boolean('auto_cdi')->default(true)->after('outcome_date');
            }
            if (! Schema::hasColumn('contracts', 'rank_override')) {
                $table->unsignedTinyInteger('rank_override')->nullable()->after('duration_months');
            }
        });
    }

    public function down(): void
    {
        Schema::table('contracts', function (Blueprint $table) {
            foreach (['auto_cdi', 'rank_override'] as $column) {
                if (Schema::hasColumn('contracts', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
