<?php

use App\Models\FuelMovement;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Lets the Global be corrected by hand (add / edit / delete a SORTIE)
 * without the next re-import of the citerne's Excel file wiping it:
 * - a row added by hand is `origin = manual` and a re-import never touches it;
 * - an imported row edited or deleted by hand leaves a fuel_movement_overrides
 *   entry keyed by the row's `fingerprint` (its original Excel values), which
 *   FuelImportService re-applies after every re-import.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_movements', function (Blueprint $table) {
            $table->enum('origin', ['import', 'manual'])->default('import')->after('source_row');
            $table->char('fingerprint', 40)->nullable()->after('origin');
            $table->boolean('edited')->default(false)->after('fingerprint');
            $table->index(['fuel_tank_id', 'fingerprint']);
        });

        Schema::create('fuel_movement_overrides', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fuel_tank_id')->constrained('fuel_tanks')->cascadeOnDelete();
            $table->char('fingerprint', 40);
            $table->enum('action', ['update', 'delete']);
            $table->json('data')->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['fuel_tank_id', 'fingerprint']);
        });

        // Backfill already-imported rows, in insertion (= sheet) order so the
        // occurrence numbering matches what the next import will compute.
        DB::table('fuel_movements')->select('fuel_tank_id')->distinct()->pluck('fuel_tank_id')->each(function ($tankId) {
            $seen = [];
            $updates = [];
            foreach (DB::table('fuel_movements')->where('fuel_tank_id', $tankId)->orderBy('id')->get() as $row) {
                $updates[$row->id] = FuelMovement::fingerprint((array) $row, $seen);
            }
            foreach (array_chunk($updates, 500, true) as $chunk) {
                $cases = implode(' ', array_map(fn ($id) => "WHEN {$id} THEN ?", array_keys($chunk)));
                DB::update("UPDATE fuel_movements SET fingerprint = CASE id {$cases} END WHERE id IN (".implode(',', array_keys($chunk)).')', array_values($chunk));
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_movement_overrides');
        Schema::table('fuel_movements', function (Blueprint $table) {
            $table->dropIndex(['fuel_tank_id', 'fingerprint']);
            $table->dropColumn(['origin', 'fingerprint', 'edited']);
        });
    }
};
