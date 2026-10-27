import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { MapPin } from 'lucide-react';
import { api } from '../api/client';
import { useSiteParams } from './useSiteParams';
import { useSelectableSites } from './useReferenceData';
import type { FuelTank } from '../types';

/**
 * Consommation's Global and Rapport always show ONE site (all of its
 * citernes), never several sites mixed. Follows the top-bar site switcher
 * when it points at a site; otherwise defaults to the first site that
 * actually has citernes. A single-site responsable gets no picker at all —
 * the server resolves their site.
 */
export function useFuelSite(label: string) {
  const siteParams = useSiteParams();
  const { sites, needsSiteSelect } = useSelectableSites();
  const [pickedSite, setPickedSite] = useState<number | null>(siteParams.site_id ?? null);
  useEffect(() => {
    if (siteParams.site_id) setPickedSite(siteParams.site_id);
  }, [siteParams.site_id]);

  const { data: allTanks, isError: tanksFailed } = useQuery({
    queryKey: ['fuel', 'tanks', {}],
    queryFn: () => api.get<FuelTank[]>('/fuel/tanks').then((r) => r.data),
    enabled: needsSiteSelect,
  });
  const tankCountBySite = useMemo(() => {
    const counts = new Map<number, number>();
    // Same rule as the Global: a citerne counts for its own site and for every site its lines belong to.
    for (const t of allTanks ?? []) {
      for (const id of new Set([Number(t.site.id), ...(t.line_sites ?? []).map((s) => Number(s.id))])) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [allTanks]);

  const siteId = needsSiteSelect ? (pickedSite ?? allTanks?.[0]?.site.id ?? (allTanks || tanksFailed ? sites[0]?.id : undefined) ?? null) : null;
  const siteFilter: { site_id?: number } = siteId ? { site_id: siteId } : {};
  const ready = !needsSiteSelect || siteId !== null;

  const sitePicker = needsSiteSelect && (
    <div className="flex flex-wrap items-center gap-2 animate-fade-up">
      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
        <MapPin size={15} className="text-orange-500" /> {label}
      </span>
      {sites.map((site) => {
        const count = tankCountBySite.get(Number(site.id)) ?? 0;
        return (
          <button
            key={site.id}
            onClick={() => setPickedSite(site.id)}
            className={clsx(
              'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition-all',
              siteId === site.id
                ? 'bg-slate-900 text-white shadow-md ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white'
                : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700',
            )}
          >
            {site.name}
            {!tanksFailed && (
              <span
                className={clsx(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  siteId === site.id ? 'bg-white/20 dark:bg-slate-900/10' : count ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-800',
                )}
                title="Citernes importées"
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return { siteId, siteFilter, ready, sitePicker };
}
