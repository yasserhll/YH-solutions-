import type { AuthUser, ModuleKey } from '../types';

/**
 * Every session (module) an account can be given, in sidebar order — same
 * keys as User::MODULES on the backend, which is what actually enforces them
 * (`module:<key>` middleware). Here they only drive the sidebar, the route
 * guards and the Utilisateurs checklist.
 */
export const MODULES: { key: ModuleKey; label: string; path: string }[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/' },
  { key: 'pointage', label: 'Pointage', path: '/pointage' },
  { key: 'conges', label: 'Congés', path: '/conges' },
  { key: 'sanctions', label: 'Sanctions', path: '/sanctions' },
  { key: 'hse', label: 'Rapports HSE', path: '/hse/rapports' },
  { key: 'mouvements', label: 'Entrées / Sorties', path: '/mouvements' },
  { key: 'affectations', label: 'Affectations', path: '/affectations' },
  { key: 'heures_sup', label: 'Heures supplémentaires', path: '/heures-supplementaires' },
  { key: 'caisse', label: 'Caisse', path: '/caisse' },
  { key: 'consommation', label: 'Consommation', path: '/consommation' },
  { key: 'personnel', label: 'Personnel', path: '/personnel' },
  { key: 'rapports', label: 'Rapports', path: '/rapports' },
  { key: 'historique', label: 'Historique', path: '/historique' },
];

export function hasModule(user: AuthUser | null | undefined, key: ModuleKey): boolean {
  return !!user?.allowed_modules.includes(key);
}

/** An hse / responsable_hse account opens the HSE mini-dashboard, the others the reports list. */
export function isHseRole(user: AuthUser | null | undefined): boolean {
  return user?.role === 'hse' || user?.role === 'responsable_hse';
}

/** Where an account lands (and is sent back to from a session it doesn't have); null = no session at all. */
export function homePath(user: AuthUser | null | undefined): string | null {
  if (isHseRole(user) && hasModule(user, 'hse')) return '/hse';
  return MODULES.find((m) => hasModule(user, m.key))?.path ?? null;
}
