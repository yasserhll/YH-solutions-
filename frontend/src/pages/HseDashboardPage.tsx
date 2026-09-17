import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ambulance, Leaf, FileWarning, ShieldAlert, ClipboardList } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import type { HseDashboardData } from '../types';
import { KpiCard } from '../components/ui/KpiCard';
import { LoadingState } from '../components/ui/States';
import { DonutStat } from '../components/ui/DonutStat';
import { StatusBadge } from '../components/ui/StatusBadge';

function frDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

export default function HseDashboardPage() {
  const siteParams = useSiteParams();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['hse-dashboard', siteParams, dateFrom, dateTo],
    queryFn: () =>
      api
        .get<HseDashboardData>('/hse-dashboard', {
          params: { ...siteParams, date_from: dateFrom || undefined, date_to: dateTo || undefined },
        })
        .then((r) => r.data),
  });

  if (isLoading || !data) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-semibold text-slate-900 dark:text-slate-100">Tableau de bord HSE</h1>
        <LoadingState rows={6} />
      </div>
    );
  }

  const { totals, general_state_breakdown, trend, by_site, recent_reports } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Tableau de bord HSE</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Vue d'ensemble des rapports journaliers — du {frDate(data.date_from)} au {frDate(data.date_to)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <span className="text-sm text-slate-400 dark:text-slate-500">à</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Rapports saisis" value={totals.reports_count} icon={ClipboardList} tone="blue" to="/hse/rapports" />
        <KpiCard label="Situations dangereuses" value={totals.dangerous_situations_count} icon={AlertTriangle} tone="amber" to="/hse/rapports" />
        <KpiCard label="Incidents" value={totals.incidents_count} icon={ShieldAlert} tone="red" to="/hse/rapports" />
        <KpiCard label="Accidents" value={totals.accidents_count} icon={Ambulance} tone="red" to="/hse/rapports" />
        <KpiCard label="Impact environnemental" value={totals.environmental_impact_count} icon={Leaf} tone="green" to="/hse/rapports" />
        <KpiCard label="Non-conformités" value={totals.non_conformities_count} icon={FileWarning} tone="amber" to="/hse/rapports" />
        <KpiCard
          label="Participation Sensibilisations HSE"
          value={totals.avg_sensitization_participation_rate !== null ? `${totals.avg_sensitization_participation_rate}%` : '—'}
          icon={ClipboardList}
          tone="teal"
        />
        <KpiCard
          label="Clôture actions correctives"
          value={totals.avg_corrective_actions_closure_rate !== null ? `${totals.avg_corrective_actions_closure_rate}%` : '—'}
          icon={ClipboardList}
          tone="purple"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DonutStat
          title="État général des rapports"
          segments={[
            { name: 'Conforme', value: general_state_breakdown.conforme, color: '#22c55e' },
            { name: 'Non conforme', value: general_state_breakdown.non_conforme, color: '#ef4444' },
          ]}
        />

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Évolution (situations dangereuses / incidents / accidents)
          </h3>
          {trend.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-slate-400 dark:text-slate-500">Aucune donnée</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" strokeOpacity={0.2} />
                  <XAxis dataKey="date" tickFormatter={frDate} tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(label) => frDate(String(label))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="dangerous_situations_count" name="Situations dangereuses" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="incidents_count" name="Incidents" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="accidents_count" name="Accidents" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {by_site.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Comparaison par site
          </h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={by_site} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" strokeOpacity={0.2} />
                <XAxis dataKey="site_name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="reports_count" name="Rapports" fill="#3b82f6" />
                <Bar dataKey="dangerous_situations_count" name="Situations dangereuses" fill="#f59e0b" />
                <Bar dataKey="incidents_count" name="Incidents" fill="#ef4444" />
                <Bar dataKey="non_conformities_count" name="Non-conformités" fill="#a855f7" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Derniers rapports</h3>
          <Link to="/hse/rapports" className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
            Voir tous les rapports
          </Link>
        </div>
        {recent_reports.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">Aucun rapport pour le moment.</div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {recent_reports.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{new Date(r.report_date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-4 py-2.5">{r.site?.name}</td>
                  <td className="px-4 py-2.5">{r.creator?.name}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={r.general_state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
