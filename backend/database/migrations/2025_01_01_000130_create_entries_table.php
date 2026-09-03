<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->string('full_name');
            $table->foreignId('position_id')->nullable()->constrained('positions')->nullOnDelete();
            $table->foreignId('department_id')->nullable()->constrained('departments')->nullOnDelete();
            $table->string('establishment')->nullable();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->date('entry_date');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['site_id', 'entry_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('entries');
    }
};
