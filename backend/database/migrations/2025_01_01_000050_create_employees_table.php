<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employees', function (Blueprint $table) {
            $table->id();
            $table->string('full_name');
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->foreignId('department_id')->nullable()->constrained('departments')->nullOnDelete();
            $table->foreignId('position_id')->nullable()->constrained('positions')->nullOnDelete();
            $table->string('establishment')->nullable();
            $table->date('entry_date')->nullable();
            $table->date('exit_date')->nullable();
            $table->enum('status', ['actif', 'sorti'])->default('actif');
            $table->string('phone')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['site_id', 'status']);
            $table->index('full_name');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employees');
    }
};
