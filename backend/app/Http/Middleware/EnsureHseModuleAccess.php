<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Guards every HSE-module route: only `hse`, `responsable_hse`, and a
 * SuperAdmin (who is unrestricted everywhere) may reach it. A plain
 * `responsable` never sees HSE reports, symmetric with BlockHseModuleRoles
 * keeping `hse`/`responsable_hse` out of every non-HSE route.
 */
class EnsureHseModuleAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || (! $user->isSuperAdmin() && ! $user->isHseModuleOnly())) {
            throw new HttpException(403, "Vous n'avez pas accès au module HSE.");
        }

        return $next($request);
    }
}
