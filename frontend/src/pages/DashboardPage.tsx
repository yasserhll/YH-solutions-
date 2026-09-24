import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import type { DashboardData } from '../types';
import { LoadingState } from '../components/ui/States';
import { StatusBadge } from '../components/ui/StatusBadge';
import { DonutStat } from '../components/ui/DonutStat';
import { SegmentedBar } from '../components/ui/SegmentedBar';

function money(n: number) {
  return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' DH';
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const siteParams = useSiteParams();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', siteParams],
    queryFn: () => api.get<DashboardData>('/dashboard', { params: siteParams }).then((r) => r.data),
  });

  if (isLoading || !data) return <LoadingState rows={8} />;

  const totalMovements30d = data.personnel.new_employees_30d + data.personnel.recent_exits_30d;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Vue graphique
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Every employee is either présent or absent today — never a third
              "non pointé" bucket, since a normal day defaults to présent and
              a Sunday/holiday defaults to absent unless manually corrected
              (see DashboardController@index and AttendanceController::daily). */}
          <DonutStat
            title="Pointage du jour"
            segments={[
              { name: 'Présents', value: data.personnel.present_today, color: '#22c55e', to: '/pointage?status=present' },
              { name: 'Absents', value: data.personnel.absent_today, color: '#ef4444', to: '/pointage?status=absent' },
            ]}
          />

          <SegmentedBar
            title="Congés"
            subtitle={`${data.leaves.pending + data.leaves.accepted + data.leaves.refused + data.leaves.cancelled + data.leaves.in_progress + data.leaves.completed} dossiers suivis`}
            segments={[
              { name: 'En attente', value: data.leaves.pending, color: '#f59e0b', to: '/conges?tab=demandes&status=en_attente' },
              { name: 'Acceptés', value: data.leaves.accepted, color: '#22c55e', to: '/conges?tab=demandes&status=acceptee' },
              { name: 'Refusés', value: data.leaves.refused, color: '#ef4444', to: '/conges?tab=demandes&status=refusee' },
              { name: 'Annulés', value: data.leaves.cancelled, color: '#94a3b8', to: '/conges?tab=demandes&status=annulee' },
              { name: 'En cours', value: data.leaves.in_progress, color: '#3b82f6', to: '/conges?tab=conges-en-cours&status=en_cours' },
              { name: 'Terminés', value: data.leaves.completed, color: '#64748b', to: '/conges?tab=conges-en-cours&status=termine' },
            ]}
          />

          <DonutStat
            title="Sanctions"
            segments={[
              { name: 'Avertissements', value: data.sanctions.warnings, color: '#f59e0b', to: '/sanctions?tab=avertissements' },
              { name: 'Mises à pied', value: data.sanctions.suspensions, color: '#ef4444', to: '/sanctions?tab=mises-a-pied' },
            ]}
          />

          <SegmentedBar
            title="Mouvements de personnel"
            subtitle={`${totalMovements30d} mouvements sur les 30 derniers jours`}
            segments={[
              { name: 'Nouveaux employés', value: data.personnel.new_employees_30d, color: '#3b82f6', to: '/mouvements?tab=entrees' },
              { name: 'Sorties', value: data.personnel.recent_exits_30d, color: '#f59e0b', to: '/mouvements?tab=sorties' },
            ]}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Dernières opérations de caisse
          </h2>
          <Link to="/caisse" className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            Voir tout →
          </Link>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Bénéficiaire</th>
                <th className="px-4 py-3 font-medium">Site</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Montant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.cash.recent_operations.map((op) => (
                <tr
                  key={op.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  onClick={() => navigate('/caisse')}
                >
                  <td className="px-4 py-2.5">{new Date(op.date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-4 py-2.5">{op.beneficiary ?? '—'}</td>
                  <td className="px-4 py-2.5">{op.site?.name}</td>
                  <td className="px-4 py-2.5">{op.description}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={op.type} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">{money(Number(op.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </section>
    </div>
  );
}
