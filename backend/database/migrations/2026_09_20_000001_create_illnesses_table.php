<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A declared sickness period (Maladie) — start_date/end_date inclusive, exactly
 * like Leave/Suspension already work. Pointage derives "Absent - Maladie" for
 * every day in this range from here (see App\Services\AttendanceAutomation)
 * instead of a manually-keyed attendance row per day — this table is the
 * single source of truth for that period, not a second copy of it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('illnesses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('site_id')->constrained();
            $table->date('start_date');
            $table->date('end_date');
            $table->text('description')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('illnesses');
    }
};
