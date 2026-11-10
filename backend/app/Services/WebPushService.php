<?php

namespace App\Services;

use App\Models\PushSubscription;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\VAPID;
use Minishlink\WebPush\WebPush;

/**
 * Sends device notifications (Web Push): they reach a browser or an installed
 * PWA (Android, desktop, iPhone once added to the Home Screen) even when the
 * app is closed. VAPID keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY if set in
 * the environment, otherwise generated once and kept in `app_settings`.
 */
class WebPushService
{
    private const SETTING = 'webpush_vapid_keys';

    /** @return array{publicKey: string, privateKey: string} */
    public function keys(): array
    {
        if (config('services.webpush.public_key') && config('services.webpush.private_key')) {
            return ['publicKey' => config('services.webpush.public_key'), 'privateKey' => config('services.webpush.private_key')];
        }

        $stored = DB::table('app_settings')->where('key', self::SETTING)->value('value');
        if (! $stored) {
            self::ensureOpenSsl();
            // insertOrIgnore: two simultaneous first requests keep ONE pair.
            DB::table('app_settings')->insertOrIgnore([
                'key' => self::SETTING,
                'value' => json_encode(VAPID::createVapidKeys()),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $stored = DB::table('app_settings')->where('key', self::SETTING)->value('value');
        }

        return json_decode($stored, true);
    }

    public function publicKey(): string
    {
        return $this->keys()['publicKey'];
    }

    /**
     * Sends one notification to every device of these users.
     * $payload: title, body, url, tag. Devices the push service reports as
     * gone (unsubscribed, app removed) are deleted.
     *
     * @param  int[]  $userIds
     * @return array{sent: int, failed: int, reasons: string[]}
     */
    public function sendToUsers(array $userIds, array $payload): array
    {
        return $this->sendTo(PushSubscription::whereIn('user_id', $userIds)->get(), $payload);
    }

    /**
     * @param  iterable<PushSubscription>|\Illuminate\Support\Collection  $subscriptions
     * @return array{sent: int, failed: int, reasons: string[]}
     */
    public function sendTo($subscriptions, array $payload): array
    {
        $subscriptions = collect($subscriptions);
        $result = ['sent' => 0, 'failed' => 0, 'reasons' => []];
        if ($subscriptions->isEmpty()) {
            return $result;
        }

        self::ensureOpenSsl();
        $keys = $this->keys();
        // urgency=high: delivered at once, even to a phone in battery saving
        // (Android Doze, iOS). TTL 4 weeks: a device that is off / offline
        // still gets it as soon as it reconnects instead of losing it. No
        // `topic`: it would let a newer alert silently replace a pending one.
        $push = new WebPush(['VAPID' => [
            'subject' => $this->subject(),
            'publicKey' => $keys['publicKey'],
            'privateKey' => $keys['privateKey'],
        ]], ['TTL' => 2419200, 'urgency' => 'high'], new \GuzzleHttp\Client(['timeout' => 15, 'connect_timeout' => 10]));
        $push->setReuseVAPIDHeaders(true);

        $json = json_encode($payload + ['icon' => '/icons/pwa-192x192.png', 'badge' => '/icons/pwa-64x64.png'], JSON_UNESCAPED_UNICODE);
        $byEndpoint = $subscriptions->keyBy('endpoint');
        $pending = $subscriptions->all();

        // Up to 3 attempts: a push service error (5xx, 429, network) or a
        // "gone" on a device registered minutes ago (the push service can
        // answer that while a brand-new subscription propagates) is retried
        // instead of losing the notification.
        for ($attempt = 1; $pending && $attempt <= 3; $attempt++) {
            if ($attempt > 1) {
                sleep($attempt === 2 ? 1 : 3);
            }
            foreach ($pending as $s) {
                $push->queueNotification(Subscription::create([
                    'endpoint' => $s->endpoint,
                    'publicKey' => $s->public_key,
                    'authToken' => $s->auth_token,
                    'contentEncoding' => $s->content_encoding ?: 'aes128gcm',
                ]), $json);
            }

            $retry = [];
            foreach ($push->flush() as $report) {
                if ($report->isSuccess()) {
                    $result['sent']++;

                    continue;
                }
                $s = $byEndpoint->get($report->getEndpoint());
                $young = $s && $s->updated_at && $s->updated_at->gt(now()->subMinutes(10));
                $status = $report->getResponse()?->getStatusCode();
                $transient = ! $report->isSubscriptionExpired() && ($status === null || $status >= 500 || $status === 429);

                if ($s && $attempt < 3 && ($transient || ($report->isSubscriptionExpired() && $young))) {
                    $retry[] = $s;

                    continue;
                }

                $result['failed']++;
                $result['reasons'][] = $report->getReason();
                if ($report->isSubscriptionExpired() && ! $young) {
                    // Really gone (app removed, permission revoked…).
                    PushSubscription::where('endpoint_hash', PushSubscription::hashEndpoint($report->getEndpoint()))->delete();
                } else {
                    Log::warning('Web Push failed', ['endpoint' => substr($report->getEndpoint(), 0, 60), 'status' => $status, 'reason' => $report->getReason()]);
                }
            }
            $pending = $retry;
        }

        return $result;
    }

    /** Contact the push services may use (an https URL or a mailto:). */
    private function subject(): string
    {
        $url = (string) config('app.url');

        return str_starts_with($url, 'https://') ? $url : 'mailto:Hallajiyasser@gmail.com';
    }

    /**
     * OpenSSL must be able to create EC keys (the VAPID keys and each
     * message's encryption key). On Linux it always can; XAMPP on Windows
     * ships without a default openssl.cnf, so PHP must be STARTED with
     * OPENSSL_CONF pointing at one (it is only read at startup), e.g.
     * C:\xampp\php\extras\ssl\openssl.cnf.
     */
    public static function ensureOpenSsl(): void
    {
        static $ok = null;
        $ok ??= openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]) !== false;
        if (! $ok) {
            abort(500, 'OpenSSL ne peut pas créer de clé sur ce serveur : notifications appareil indisponibles (démarrez PHP avec OPENSSL_CONF défini).');
        }
    }
}
