<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attendances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->date('date');
            $table->enum('status', ['present', 'absent'])->default('present');
            $table->enum('absence_cause', ['maladie', 'autorisee', 'non_autorisee', 'conge'])->nullable();
            $table->text('description')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['employee_id', 'date']);
            $table->index(['site_id', 'date']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendances');
    }
};
