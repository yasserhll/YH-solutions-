import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { MapPin } from 'lucide-react';
import { api } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useSelectableSites } from '../hooks/useReferenceData';
import type { FuelAssignment } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { AssignmentsView } from './ConsommationReportTab';

/**
 * Affectation session: each camion / engin of a site with its conducteur
 * of the 1st and 2nd shift (the company's "LISTE D'AFFECTATION"). Same data
 * as Consommation → Rapport → Affectation (`fuel_assignments`), which the
 * daily fuel report reads its drivers from. One site at a time: a
 * SuperAdmin / multi-site account picks it, a single-site account (e.g. a
 * pompiste) is resolved server-side.
 */
export default function AffectationMaterielPage() {
  const siteParams = useSiteParams();
  const { sites, needsSiteSelect } = useSelectableSites();
  const [picked, setPicked] = useState<number | null>(siteParams.site_id ?? null);
  useEffect(() => {
    if (siteParams.site_id) setPicked(siteParams.site_id);
  }, [siteParams.site_id]);

  const siteId = needsSiteSelect ? (picked ?? sites[0]?.id ?? null) : null;
  const siteFilter: { site_id?: number } = siteId ? { site_id: siteId } : {};
  const ready = !needsSiteSelect || siteId !== null;

  const { data: assignments } = useQuery({
    queryKey: ['fuel', 'assignments', siteFilter],
    queryFn: () => api.get<FuelAssignment[]>('/fuel/assignments', { params: siteFilter }).then((r) => r.data),
    enabled: ready,
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Affectation matériel" description="Chaque camion et engin avec ses conducteurs du 1er et du 2ème shift" />

      {needsSiteSelect && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
            <MapPin size={15} className="text-orange-500" /> Site
          </span>
          {sites.map((site) => (
            <button
              key={site.id}
              onClick={() => setPicked(site.id)}
              className={clsx(
                'rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition-colors',
                siteId === site.id
                  ? 'bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white'
                  : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700',
              )}
            >
              {site.name}
            </button>
          ))}
        </div>
      )}

      {ready && <AssignmentsView key={siteId ?? 'own'} siteFilter={siteFilter} assignments={assignments} />}
    </div>
  );
}
