import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, BellRing, CheckCircle2, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useSiteParams } from '../hooks/useSiteParams';
import { hasModule } from '../utils/modules';
import type { Contract, ContractSummary, Paginated } from '../types';
import { autoCdi, contractLabel } from '../utils/contracts';

const DAY = 86_400_000;
const utcDay = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z');
const STORAGE_KEY = 'contract-notif-seen';

function readSeen(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeSeen(value: string) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private mode: the panel just opens again next time */
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

/** The contract's elapsed share, overdue days in red — same reading as the Contrats page. */
function MiniBar({ c }: { c: Contract }) {
  if (!c.end_date || c.days_left === null) return null;
  const total = Math.max(1, Math.round((utcDay(c.end_date) - utcDay(c.start_date)) / DAY) + 1);
  const late = c.days_left < 0 ? -c.days_left : 0;
  const green = late ? (total / (total + late)) * 100 : Math.min(100, ((total - c.days_left) / total) * 100);

  return (
    <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div className={clsx('h-full', late ? 'bg-emerald-500' : 'rounded-full bg-amber-500')} style={{ width: `${green}%` }} />
      {late > 0 && <div className="h-full bg-red-500" style={{ width: `${Math.max(4, 100 - green)}%` }} />}
    </div>
  );
}

/**
 * Bell in the top bar: contracts ending within `alert_days` or already ended
 * (Contrats session). The panel opens by itself on the Dashboard once a day —
 * and again whenever the counts change — and from the bell anywhere else.
 */
export function ContractNotifications({ autoOpen }: { autoOpen: boolean }) {
  const { user } = useAuth();
  const siteParams = useSiteParams();
  const enabled = hasModule(user, 'contrats');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const summaryQuery = useQuery({
    queryKey: ['contracts-summary', siteParams],
    queryFn: () => api.get<ContractSummary>('/contracts/summary', { params: siteParams }).then((r) => r.data),
    enabled,
    refetchInterval: 5 * 60_000,
  });
  const summary = summaryQuery.data;
  const count = (summary?.bientot ?? 0) + (summary?.termine ?? 0);

  const listQuery = useQuery({
    queryKey: ['contracts', 'notifications', siteParams],
    queryFn: () =>
      api
        .get<Paginated<Contract>>('/contracts', { params: { ...siteParams, state: 'a_traiter', per_page: 5 } })
        .then((r) => r.data),
    enabled: enabled && (open || count > 0),
  });

  const signature = summary ? `${new Date().toISOString().slice(0, 10)}:${summary.termine}:${summary.bientot}` : null;

  // Auto-open on the Dashboard, once per day / per new set of alerts.
  useEffect(() => {
    if (autoOpen && signature && count > 0 && readSeen() !== signature) {
      const t = setTimeout(() => setOpen(true), 400);
      return () => clearTimeout(t);
    }
  }, [autoOpen, signature, count]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });

  function close() {
    setOpen(false);
    if (signature) writeSeen(signature);
  }

  if (!enabled) return null;

  const rows = listQuery.data?.data ?? [];
  const more = (listQuery.data?.total ?? 0) - rows.length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        className={clsx(
          'relative rounded-full p-2 transition-colors',
          count > 0
            ? 'text-amber-500 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10'
            : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
        )}
        aria-label={count > 0 ? `${count} contrat(s) à traiter` : 'Notifications contrats'}
        title={count > 0 ? `${count} contrat(s) à traiter` : 'Aucun contrat à traiter'}
      >
        {count > 0 ? <BellRing size={20} className="animate-bell-ring" /> : <Bell size={20} />}
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-40" />
            <span className="relative inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
              {count > 99 ? '99+' : count}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div className="animate-notif-in absolute right-0 top-12 z-50 w-[min(92vw,380px)] origin-top-right overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/40">
          <div className="relative flex items-start gap-3 bg-gradient-to-br from-amber-500 to-red-500 px-4 py-3.5 text-white">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
              <BellRing size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Contrats à traiter</div>
              <div className="text-xs text-white/85">
                {count === 0
                  ? 'Tout est à jour'
                  : [
                      summary?.termine ? `${summary.termine} terminé(s)` : null,
                      summary?.bientot ? `${summary.bientot} dans moins de ${summary.alert_days} j` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </div>
            </div>
            <button onClick={close} className="rounded-full p-1 text-white/80 hover:bg-white/20 hover:text-white" aria-label="Fermer">
              <X size={16} />
            </button>
          </div>

          {count === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              <CheckCircle2 size={28} className="text-emerald-500" />
              Aucun contrat ne se termine dans les prochains jours.
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {rows.map((c, i) => {
                const late = c.days_left !== null && c.days_left < 0;
                return (
                  <li key={c.id} className="animate-fade-up" style={{ animationDelay: `${80 + i * 50}ms` }}>
                    <Link
                      to="/contrats?state=a_traiter"
                      onClick={close}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div
                        className={clsx(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                          late
                            ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
                            : 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
                        )}
                      >
                        {initials(c.employee?.full_name ?? '?')}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.employee?.full_name}</span>
                          <span
                            className={clsx(
                              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                              late
                                ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
                            )}
                          >
                            {late
                              ? `en retard de ${-(c.days_left ?? 0)} j`
                              : autoCdi(c)
                                ? `CDI auto dans ${c.days_left} j`
                                : c.days_left === 0
                                  ? "aujourd'hui"
                                  : `dans ${c.days_left} j`}
                          </span>
                        </div>
                        <div className="truncate text-xs text-slate-400 dark:text-slate-500">
                          {contractLabel(c)} · {c.duration_months} mois · {c.employee?.site?.name}
                        </div>
                        <MiniBar c={c} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <Link
            to="/contrats?state=a_traiter"
            onClick={close}
            className="flex items-center justify-center gap-1.5 border-t border-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/60"
          >
            {more > 0 ? `Voir les ${listQuery.data?.total} contrats` : 'Voir les contrats'}
            <ArrowRight size={15} />
          </Link>
        </div>
      )}
    </div>
  );
}
