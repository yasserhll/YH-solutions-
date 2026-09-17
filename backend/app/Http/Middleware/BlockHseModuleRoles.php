<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * `hse` and `responsable_hse` accounts are restricted to ONLY the HSE
 * module — this wraps every other route (Dashboard, Personnel, Pointage,
 * Congés, Sanctions, Mouvements, Affectations, Caisse, Rapports,
 * Utilisateurs, Sites/Départements/Fonctions, Holidays...) and blocks them,
 * even though nothing else about those routes is site- or role-specific to
 * them. This is enforced server-side, never trusted to the frontend nav
 * filtering alone.
 */
class BlockHseModuleRoles
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && $user->isHseModuleOnly()) {
            throw new HttpException(403, 'Ce compte est réservé au module HSE.');
        }

        return $next($request);
    }
}
