<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leave_extensions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('leave_id')->constrained('leaves')->cascadeOnDelete();
            $table->unsignedInteger('extra_days');
            $table->text('reason')->nullable();
            $table->date('previous_end_date');
            $table->date('new_end_date');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_extensions');
    }
};
