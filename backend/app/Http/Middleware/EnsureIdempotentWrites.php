<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * A write (POST/PUT/PATCH/DELETE) carrying an `X-Idempotency-Key` header is
 * executed at most ONCE per session. Every other copy of the same request
 * gets the first one's stored response (header `Idempotent-Replayed: true`)
 * and changes nothing.
 *
 * Why: the PWA queues writes made without network and replays them when the
 * network comes back (public/offline-sw.js). A request whose response was
 * lost on a flaky connection — the server DID save it — is indistinguishable
 * from one that never arrived, so it gets replayed. Without this, one report
 * typed offline was created 15-20 times.
 *
 * The frontend (api/client.ts) gives each write its own key; the offline
 * queue stores and replays it with that same key.
 */
class EnsureIdempotentWrites
{
    /** How long the first copy may run before a second copy stops waiting for it. */
    private const WAIT_SECONDS = 15;

    private const KEEP_DAYS = 7;

    public function handle(Request $request, Closure $next): Response
    {
        $key = (string) $request->header('X-Idempotency-Key', '');
        $token = $request->bearerToken();

        if (
            in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)
            || $key === '' || ! $token
            || ! preg_match('/^[A-Za-z0-9_-]{8,100}$/', $key)
        ) {
            return $next($request);
        }

        $scope = hash('sha256', $token);

        // Claim the key; if a copy already holds it, answer like that copy.
        // (Two rounds: a copy that failed with a 5xx releases the key.)
        for ($round = 0; ; $round++) {
            try {
                $claimed = DB::table('idempotency_keys')->insertOrIgnore([
                    'scope' => $scope,
                    'key' => $key,
                    'method' => $request->method(),
                    'path' => mb_substr($request->path(), 0, 255),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]) > 0;
            } catch (QueryException $e) {
                // Table not migrated yet on this server: never block writes for it.
                Log::warning('idempotency_keys unavailable: '.$e->getMessage());

                return $next($request);
            }

            if ($claimed) {
                break;
            }
            $replayed = $this->replay($scope, $key);
            if ($replayed || $round >= 1) {
                return $replayed ?? $this->busy();
            }
        }

        $response = $next($request);
        $this->remember($scope, $key, $response);

        if (random_int(1, 200) === 1) {
            DB::table('idempotency_keys')->where('created_at', '<', now()->subDays(self::KEEP_DAYS))->delete();
        }

        return $response;
    }

    /**
     * A copy of a request already received: wait for the first one and
     * answer like it. null = the key is free again (the first copy failed
     * with a 5xx, or died without answering), the caller runs the request.
     */
    private function replay(string $scope, string $key): ?Response
    {
        $deadline = microtime(true) + self::WAIT_SECONDS;

        do {
            $row = DB::table('idempotency_keys')->where('scope', $scope)->where('key', $key)->first();

            if (! $row) {
                return null;
            }
            if ($row->status !== null) {
                return response($row->body ?? '', (int) $row->status, array_filter([
                    'Content-Type' => $row->content_type,
                    'Idempotent-Replayed' => 'true',
                ]));
            }
            // PHP killed mid-request (timeout, crash): the claim would block the key forever.
            if (now()->diffInSeconds($row->updated_at, true) > 600) {
                DB::table('idempotency_keys')->where('id', $row->id)->whereNull('status')->delete();

                return null;
            }
            usleep(250_000);
        } while (microtime(true) < $deadline);

        return $this->busy();
    }

    private function busy(): Response
    {
        return response()->json([
            'message' => 'Cette action est déjà en cours d’enregistrement. Patientez quelques secondes puis rechargez la page.',
        ], 409, ['Retry-After' => '5']);
    }

    private function remember(string $scope, string $key, Response $response): void
    {
        $status = $response->getStatusCode();
        $query = DB::table('idempotency_keys')->where('scope', $scope)->where('key', $key);

        // A server error or a rate limit may succeed on retry: don't pin it.
        // A stream / file can't be stored: the action ran, its copies get a bare 204.
        if ($status >= 500 || $status === 429) {
            $query->delete();

            return;
        }

        $storable = ! $response instanceof StreamedResponse && ! $response instanceof BinaryFileResponse;

        $query->update([
            'status' => $storable ? $status : 204,
            'content_type' => $storable ? mb_substr((string) $response->headers->get('Content-Type'), 0, 150) : null,
            'body' => $storable ? $response->getContent() : null,
            'updated_at' => now(),
        ]);
    }
}
