import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { Department, Holiday, Position, Site } from '../types';

export function useSites() {
  return useQuery({ queryKey: ['sites'], queryFn: () => api.get<Site[]>('/sites').then((r) => r.data) });
}

/**
 * Sites the current user may pick from on a site-scoped create form
 * (declaring a cash expense, recording an entry/exit, adding an employee...):
 * every site for a SuperAdmin, but ONLY the sites assigned to a responsable —
 * a multi-site responsable (e.g. assigned to Bouchane + Mzinda) must never
 * see Ben Guerir or Louta in this dropdown. Also reports whether a select is
 * needed at all: a single-site responsable never needs one, since the
 * backend auto-resolves their one site (see InteractsWithSites::resolveSiteId).
 */
export function useSelectableSites(): { sites: Site[]; needsSiteSelect: boolean; isSuperAdmin: boolean } {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'superadmin';
  const allSites = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get<Site[]>('/sites').then((r) => r.data),
    enabled: isSuperAdmin,
  });

  if (isSuperAdmin) {
    return { sites: allSites.data ?? [], needsSiteSelect: true, isSuperAdmin: true };
  }

  const sites = user?.sites ?? [];
  return { sites, needsSiteSelect: sites.length > 1, isSuperAdmin: false };
}

export function useDepartments() {
  return useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments').then((r) => r.data) });
}

export function usePositions() {
  return useQuery({ queryKey: ['positions'], queryFn: () => api.get<Position[]>('/positions').then((r) => r.data) });
}

export function useHolidays() {
  return useQuery({ queryKey: ['holidays'], queryFn: () => api.get<Holiday[]>('/holidays').then((r) => r.data) });
}
