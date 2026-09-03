<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leaves', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->foreignId('site_id')->constrained('sites')->cascadeOnDelete();
            $table->foreignId('leave_request_id')->nullable()->constrained('leave_requests')->nullOnDelete();
            $table->date('start_date');
            $table->unsignedInteger('duration_days');
            $table->date('end_date');
            $table->text('reason')->nullable();
            $table->enum('status', ['en_cours', 'termine'])->default('en_cours');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['site_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leaves');
    }
};
