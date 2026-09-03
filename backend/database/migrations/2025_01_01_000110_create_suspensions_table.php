<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('suspensions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->date('date');
            $table->string('reason');
            $table->text('description')->nullable();
            $table->unsignedInteger('duration_days');
            $table->date('start_date');
            $table->date('end_date');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['site_id', 'date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('suspensions');
    }
};
