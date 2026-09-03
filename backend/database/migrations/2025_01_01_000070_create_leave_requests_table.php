<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leave_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->date('request_date');
            $table->date('desired_start_date');
            $table->unsignedInteger('duration_days');
            $table->text('reason')->nullable();
            $table->enum('status', ['en_attente', 'acceptee', 'refusee', 'annulee'])->default('en_attente');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['site_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_requests');
    }
};
