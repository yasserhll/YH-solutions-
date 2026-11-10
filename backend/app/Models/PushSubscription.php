<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A browser / installed PWA that receives device notifications (Web Push). */
class PushSubscription extends Model
{
    protected $fillable = ['user_id', 'endpoint', 'endpoint_hash', 'public_key', 'auth_token', 'content_encoding', 'user_agent'];

    protected $hidden = ['public_key', 'auth_token'];

    public static function hashEndpoint(string $endpoint): string
    {
        return hash('sha256', $endpoint);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
