import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useFuelSite } from '../hooks/useFuelSite';
import type { FuelAssignment } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { AssignmentsView } from './ConsommationReportTab';

/**
 * Affectation session: each camion / engin of a site with its conducteur
 * of the 1st and 2nd shift (the company's "LISTE D'AFFECTATION"). It IS
 * Consommation → Rapport → Affectation: same data (`fuel_assignments`), same
 * endpoints, same query key (an edit here shows there at once and the daily
 * fuel report reads its drivers from it), and the same site resolution
 * (`useFuelSite`: the top-bar site, else the site last picked on either
 * screen, else the first site with citernes; a single-site account such as
 * a pompiste is resolved server-side).
 */
export default function AffectationMaterielPage() {
  const { siteId, siteFilter, ready, sitePicker } = useFuelSite('Site :');

  const { data: assignments } = useQuery({
    queryKey: ['fuel', 'assignments', siteFilter],
    queryFn: () => api.get<FuelAssignment[]>('/fuel/assignments', { params: siteFilter }).then((r) => r.data),
    enabled: ready,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Affectation matériel"
        description="Chaque camion et engin avec ses conducteurs du 1er et du 2ème shift — la même affectation que Consommation → Rapport → Affectation."
      />
      {sitePicker}
      {ready && <AssignmentsView key={siteId ?? 'own'} siteFilter={siteFilter} assignments={assignments} />}
    </div>
  );
}
