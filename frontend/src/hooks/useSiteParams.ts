import { useSiteFilter } from '../contexts/SiteFilterContext';

export function useSiteParams(): Record<string, number> {
  const { siteId } = useSiteFilter();
  return siteId ? { site_id: siteId } : {};
}
