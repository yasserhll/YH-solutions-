<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `module:caisse` (or `module:pointage,conges` = any of them): lets the
 * request through only if the account was given that session (User::hasModule).
 * This is the real enforcement of the per-account access a SuperAdmin picks
 * in Utilisateurs — the sidebar/route guards on the frontend are UX only.
 */
class EnsureModuleAccess
{
    public function handle(Request $request, Closure $next, string ...$modules): Response
    {
        $user = $request->user();

        if (! $user || ! collect($modules)->contains(fn ($module) => $user->hasModule($module))) {
            abort(403, "Vous n'avez pas accès à cette session.");
        }

        return $next($request);
    }
}
