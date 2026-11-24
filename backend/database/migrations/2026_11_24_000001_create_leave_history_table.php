<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The old leave history kept in the sites' "ETAT DE CONGE" workbooks: the
 * number of days of congé taken per employee per calendar month (the files
 * never had exact dates). One row per employee + month. Create-only.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('leave_history')) {
            Schema::create('leave_history', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->foreignId('site_id')->constrained('sites');
                $table->unsignedSmallInteger('year');
                $table->unsignedTinyInteger('month');
                $table->decimal('days', 5, 1);
                $table->string('source', 20)->default('import');
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                $table->unique(['employee_id', 'year', 'month']);
                $table->index(['site_id', 'year', 'month']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_history');
    }
};
