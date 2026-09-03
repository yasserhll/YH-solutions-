import { createContext, useContext, useState, type ReactNode } from 'react';

interface SiteFilterContextValue {
  siteId: number | null;
  setSiteId: (id: number | null) => void;
}

const SiteFilterContext = createContext<SiteFilterContextValue | null>(null);

export function SiteFilterProvider({ children }: { children: ReactNode }) {
  const [siteId, setSiteId] = useState<number | null>(null);
  return <SiteFilterContext.Provider value={{ siteId, setSiteId }}>{children}</SiteFilterContext.Provider>;
}

export function useSiteFilter() {
  const ctx = useContext(SiteFilterContext);
  if (!ctx) throw new Error('useSiteFilter must be used within SiteFilterProvider');
  return ctx;
}
