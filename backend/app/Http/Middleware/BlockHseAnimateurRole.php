<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Narrower than BlockHseModuleRoles: blocks only the `hse` (animateur) role,
 * NOT `responsable_hse`. Used on the handful of modules a responsable_hse
 * also needs for safety oversight — Pointage, Congés, Sanctions,
 * Entrées/Sorties, Affectations — while an `hse` account stays confined to
 * strictly the HSE module (daily report + its own dashboard).
 */
class BlockHseAnimateurRole
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->user() && $request->user()->isHse()) {
            throw new HttpException(403, 'Ce compte est réservé au module HSE.');
        }

        return $next($request);
    }
}
