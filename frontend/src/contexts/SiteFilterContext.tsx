import { createContext, useContext, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';

interface SiteFilterContextValue {
  siteId: number | null;
  setSiteId: (id: number | null) => void;
}

const SiteFilterContext = createContext<SiteFilterContextValue | null>(null);

export function SiteFilterProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Remembered per account: a site picked by a previous login in the same tab
  // (e.g. a SuperAdmin on Mzinda) must never leak into the next account's
  // requests — the backend 403s it and every list errors out.
  const [selection, setSelection] = useState<{ userId: number | null; siteId: number | null }>({ userId: null, siteId: null });
  const userId = user?.id ?? null;
  let siteId = selection.userId === userId ? selection.siteId : null;
  if (siteId !== null && user && user.role !== 'superadmin' && !user.sites.some((s) => s.id === siteId)) siteId = null;

  const setSiteId = (id: number | null) => setSelection({ userId, siteId: id });

  return <SiteFilterContext.Provider value={{ siteId, setSiteId }}>{children}</SiteFilterContext.Provider>;
}

export function useSiteFilter() {
  const ctx = useContext(SiteFilterContext);
  if (!ctx) throw new Error('useSiteFilter must be used within SiteFilterProvider');
  return ctx;
}
