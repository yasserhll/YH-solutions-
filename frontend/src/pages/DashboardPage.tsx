import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users,
  UserCheck,
  UserX,
  CalendarClock,
  UserPlus,
  UserMinus,
  CalendarDays,
  CalendarCheck,
  Hourglass,
  ShieldAlert,
  Ban,
  Wallet,
  TrendingDown,
} from 'lucide-react';
import { api } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import type { DashboardData } from '../types';
import { KpiCard } from '../components/ui/KpiCard';
import { LoadingState } from '../components/ui/States';
import { StatusBadge } from '../components/ui/StatusBadge';

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

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Personnel</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total employés" value={data.personnel.total} icon={Users} to="/personnel" />
          <KpiCard label="Présents aujourd'hui" value={data.personnel.present_today} icon={UserCheck} tone="green" to="/pointage" />
          <KpiCard label="Absents aujourd'hui" value={data.personnel.absent_today} icon={UserX} tone="red" to="/pointage" />
          <KpiCard
            label="Congés en cours"
            value={data.personnel.leaves_in_progress}
            icon={CalendarClock}
            tone="blue"
            to="/conges?tab=conges-en-cours"
          />
          <KpiCard label="Nouveaux (30j)" value={data.personnel.new_employees_30d} icon={UserPlus} tone="purple" to="/personnel" />
          <KpiCard
            label="Sorties récentes"
            value={data.personnel.recent_exits_30d}
            icon={UserMinus}
            tone="amber"
            to="/mouvements?tab=sorties"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Pointage du jour</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard label="Présents" value={data.attendance.present} icon={UserCheck} tone="green" to="/pointage" />
          <KpiCard label="Absents maladie" value={data.attendance.absent_maladie} icon={UserX} tone="amber" to="/pointage" />
          <KpiCard label="Absents autorisée" value={data.attendance.absent_autorisee} icon={UserX} tone="blue" to="/pointage" />
          <KpiCard label="Absents justifié" value={data.attendance.absent_justifie} icon={UserX} tone="teal" to="/pointage" />
          <KpiCard
            label="Absents non autorisée"
            value={data.attendance.absent_non_autorisee}
            icon={UserX}
            tone="red"
            to="/pointage"
          />
          <KpiCard label="Absents en congé" value={data.attendance.absent_conge} icon={UserX} tone="purple" to="/pointage" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Congés</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard label="Demandes en attente" value={data.leaves.pending} icon={Hourglass} tone="amber" to="/conges?tab=demandes" />
          <KpiCard label="Congés acceptés" value={data.leaves.accepted} icon={CalendarCheck} tone="green" to="/conges?tab=demandes" />
          <KpiCard
            label="Congés en cours"
            value={data.leaves.in_progress}
            icon={CalendarDays}
            tone="blue"
            to="/conges?tab=conges-en-cours"
          />
          <KpiCard
            label="Congés terminés"
            value={data.leaves.completed}
            icon={CalendarCheck}
            tone="slate"
            to="/conges?tab=conges-en-cours"
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Sanctions</h2>
          <div className="grid grid-cols-2 gap-4">
            <KpiCard
              label="Avertissements"
              value={data.sanctions.warnings}
              icon={ShieldAlert}
              tone="amber"
              to="/sanctions?tab=avertissements"
            />
            <KpiCard label="Mises à pied" value={data.sanctions.suspensions} icon={Ban} tone="red" to="/sanctions?tab=mises-a-pied" />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Caisse</h2>
          <div className="grid grid-cols-2 gap-4">
            {data.cash.current_balance !== null && (
              <KpiCard
                label="Solde caisse global actuel"
                value={money(data.cash.current_balance)}
                icon={Wallet}
                tone={data.cash.current_balance < 0 ? 'red' : 'green'}
                to="/caisse"
              />
            )}
            {data.cash.site_balance !== null && (
              <KpiCard
                label="Solde de mon site"
                value={money(data.cash.site_balance)}
                icon={Wallet}
                tone={data.cash.site_balance <= 0 ? 'red' : 'green'}
                to="/caisse"
              />
            )}
            <KpiCard label="Dépenses du mois" value={money(data.cash.expenses_month)} icon={TrendingDown} tone="red" to="/caisse" />
          </div>
        </section>
      </div>

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
          <table className="w-full text-left text-sm">
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
      </section>
    </div>
  );
}
