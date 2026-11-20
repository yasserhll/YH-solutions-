<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per write request the frontend tagged with an X-Idempotency-Key
 * (App\Http\Middleware\EnsureIdempotentWrites): the same request sent twice
 * — replayed by the offline queue after its first response was lost, a
 * double tap, a network retry — runs ONCE, the copies get the stored
 * response. Create-only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->id();
            // sha256 of the bearer token: a key only ever matches the same session.
            $table->char('scope', 64);
            $table->string('key', 100);
            $table->string('method', 10);
            $table->string('path', 255);
            // null while the first request is still running.
            $table->unsignedSmallInteger('status')->nullable();
            $table->string('content_type', 150)->nullable();
            $table->longText('body')->nullable();
            $table->timestamps();

            $table->unique(['scope', 'key']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_keys');
    }
};
