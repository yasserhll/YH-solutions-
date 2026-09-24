import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  History,
  Clock,
  HeartPulse,
  CalendarDays,
  Hourglass,
  ShieldAlert,
  Ban,
  Briefcase,
  LogIn,
  LogOut,
  Wallet,
  Users,
} from 'lucide-react';
import { api } from '../api/client';
import { useSiteParams } from '../hooks/useSiteParams';
import { useAuth } from '../contexts/AuthContext';
import type { AuditLog, Paginated } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { Pagination } from '../components/ui/Pagination';
import { LoadingState, EmptyState } from '../components/ui/States';

/**
 * One entry per module prefix on `action` (`<module>.<verb>`, see the
 * backend AuditLogger doc) — drives both the filter dropdown's options and
 * each row's icon/color, so a new module only needs an entry added here,
 * never a parallel hardcoded list kept in sync by hand.
 */
const moduleMeta: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  attendance: { label: 'Pointage', icon: Clock, tone: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10' },
  illness: { label: 'Maladies', icon: HeartPulse, tone: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
  leave: { label: 'Congés pris', icon: CalendarDays, tone: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10' },
  leave_request: { label: 'Demandes de congé', icon: Hourglass, tone: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
  warning: { label: 'Avertissements', icon: ShieldAlert, tone: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
  suspension: { label: 'Mises à pied', icon: Ban, tone: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
  assignment: { label: 'Affectations', icon: Briefcase, tone: 'text-purple-500 bg-purple-50 dark:bg-purple-500/10' },
  entry: { label: 'Entrées', icon: LogIn, tone: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' },
  exit: { label: 'Sorties', icon: LogOut, tone: 'text-slate-500 bg-slate-100 dark:bg-slate-800' },
  cash_transaction: { label: 'Caisse', icon: Wallet, tone: 'text-teal-500 bg-teal-50 dark:bg-teal-500/10' },
  employee: { label: 'Personnel', icon: Users, tone: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' },
};

function moduleOf(action: string) {
  return moduleMeta[action.split('.')[0]] ?? { label: 'Autre', icon: History, tone: 'text-slate-500 bg-slate-100 dark:bg-slate-800' };
}

function dayLabel(dateStr: string) {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (sameDay(date, today)) return "Aujourd'hui";
  if (sameDay(date, yesterday)) return 'Hier';
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function HistoriquePage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [module, setModule] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const siteParams = useSiteParams();
  const { user } = useAuth();
  const showSiteColumn = user?.role === 'superadmin' || (user?.sites?.length ?? 0) > 1;

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', siteParams, page, search, module, dateFrom, dateTo],
    queryFn: () =>
      api
        .get<Paginated<AuditLog>>('/audit-logs', {
          params: {
            ...siteParams,
            page,
            search: search || undefined,
            module: module || undefined,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
          },
        })
        .then((r) => r.data),
  });

  const rows = data?.data ?? [];

  // Group consecutive rows by calendar day for the "Aujourd'hui / Hier / <date>"
  // section headers — rows already arrive sorted most-recent-first from the backend.
  const groups: { label: string; items: AuditLog[] }[] = [];
  for (const row of rows) {
    const label = dayLabel(row.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(row);
    } else {
      groups.push({ label, items: [row] });
    }
  }

  return (
    <div>
      <PageHeader title="Historique" description="Journal de toutes les actions effectuées dans l'application" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <SearchInput placeholder="Rechercher..." value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        <select
          value={module}
          onChange={(e) => (setModule(e.target.value), setPage(1))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="">Tous les modules</option>
          {Object.entries(moduleMeta).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => (setDateFrom(e.target.value), setPage(1))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <span className="text-sm text-slate-400 dark:text-slate-500">à</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => (setDateTo(e.target.value), setPage(1))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        {(dateFrom || dateTo || module || search) && (
          <button
            type="button"
            onClick={() => (setSearch(''), setModule(''), setDateFrom(''), setDateTo(''), setPage(1))}
            className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Réinitialiser
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {isLoading ? (
          <LoadingState rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="Aucune action enregistrée"
            message="Aucune action ne correspond aux filtres sélectionnés."
          />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
                  {group.label}
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {group.items.map((row) => {
                    const meta = moduleOf(row.action);
                    const Icon = meta.icon;
                    return (
                      <div key={row.id} className="flex items-start gap-3 px-4 py-3">
                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>
                          <Icon size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-800 dark:text-slate-100">{row.description}</p>
                          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                            {meta.label}
                            {row.user?.name && ` · ${row.user.name}`}
                            {showSiteColumn && row.site?.name && ` · ${row.site.name}`}
                          </p>
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">
                          {new Date(row.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {data && <Pagination page={data.current_page} lastPage={data.last_page} total={data.total} onPageChange={setPage} />}
      </div>
    </div>
  );
}
