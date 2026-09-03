<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Every API response carries per-request-token data (site-scoped lists, the
 * caller's own identity, ...), so none of it may ever be served from the
 * browser's HTTP cache for a *different* Authorization header — that cache
 * is keyed by URL only, not by header, so without this a second account
 * logging in on the same browser could see the first account's cached
 * responses (their role, their site's data...) until the entry expires.
 * The service worker's own Cache Storage is a separate, correctly-scoped
 * layer (see vite.config.ts) — this middleware only stops the browser's
 * built-in cache underneath it.
 */
class PreventApiCaching
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

        return $response;
    }
}
