<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PushSubscription;
use App\Services\WebPushService;
use Illuminate\Http\Request;

/**
 * "Notifications sur cet appareil": registers / removes the current device
 * (browser or installed PWA) for Web Push, and sends a test notification.
 */
class PushSubscriptionController extends Controller
{
    public function __construct(private WebPushService $push) {}

    public function key()
    {
        return ['public_key' => $this->push->publicKey()];
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'endpoint' => ['required', 'url', 'max:2000'],
            'keys.p256dh' => ['required', 'string', 'max:255'],
            'keys.auth' => ['required', 'string', 'max:255'],
            'content_encoding' => ['nullable', 'in:aes128gcm,aesgcm'],
        ]);

        // A device belongs to whoever turned it on last on that browser.
        PushSubscription::updateOrCreate(
            ['endpoint_hash' => PushSubscription::hashEndpoint($data['endpoint'])],
            [
                'user_id' => $request->user()->id,
                'endpoint' => $data['endpoint'],
                'public_key' => $data['keys']['p256dh'],
                'auth_token' => $data['keys']['auth'],
                'content_encoding' => $data['content_encoding'] ?? 'aes128gcm',
                'user_agent' => substr((string) $request->userAgent(), 0, 255),
            ]
        );

        return response()->json(['message' => 'Notifications activées sur cet appareil.'], 201);
    }

    /**
     * Called by the service worker itself (no login token there) when the
     * browser replaces a device's subscription (`pushsubscriptionchange`):
     * knowing the old endpoint — a secret URL only that device has — is what
     * authorizes moving the row to the new one, so the device keeps
     * receiving without anyone reopening the app.
     */
    public function renew(Request $request)
    {
        $data = $request->validate([
            'old_endpoint' => ['required', 'string', 'max:2000'],
            'endpoint' => ['required', 'url', 'max:2000'],
            'keys.p256dh' => ['required', 'string', 'max:255'],
            'keys.auth' => ['required', 'string', 'max:255'],
        ]);

        $row = PushSubscription::where('endpoint_hash', PushSubscription::hashEndpoint($data['old_endpoint']))->first();
        abort_unless($row, 404);

        $newHash = PushSubscription::hashEndpoint($data['endpoint']);
        PushSubscription::where('endpoint_hash', $newHash)->where('id', '!=', $row->id)->delete();
        $row->update([
            'endpoint' => $data['endpoint'],
            'endpoint_hash' => $newHash,
            'public_key' => $data['keys']['p256dh'],
            'auth_token' => $data['keys']['auth'],
        ]);

        return response()->noContent();
    }

    public function destroy(Request $request)
    {
        $data = $request->validate(['endpoint' => ['required', 'string']]);

        PushSubscription::where('endpoint_hash', PushSubscription::hashEndpoint($data['endpoint']))
            ->where('user_id', $request->user()->id)
            ->delete();

        return response()->noContent();
    }

    /** Sends a test notification to THIS device (or all the account's devices). */
    public function test(Request $request)
    {
        $endpoint = $request->input('endpoint');
        $query = PushSubscription::where('user_id', $request->user()->id);
        if ($endpoint) {
            $query->where('endpoint_hash', PushSubscription::hashEndpoint($endpoint));
        }
        if (! $query->exists()) {
            abort(422, "Cet appareil n'est pas enregistré pour les notifications.");
        }

        $payload = [
            'title' => 'Notifications activées',
            'body' => 'Vous recevrez ici les alertes des contrats (fin dans 10 jours, contrat terminé).',
            'url' => '/contrats',
            'tag' => 'test',
        ];

        $result = $this->push->sendTo($query->get(), $payload);

        if ($result['sent'] === 0) {
            abort(502, "La notification n'a pas pu être envoyée".($result['reasons'] ? ' : '.$result['reasons'][0] : '.'));
        }

        return $result;
    }
}
