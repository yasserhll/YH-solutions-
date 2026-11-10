import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Bell, CheckCircle2, Clock, Loader2, Smartphone, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useSiteParams } from '../hooks/useSiteParams';
import { syncPushSubscription, usePushNotifications, type PushStatus } from '../hooks/usePushNotifications';
import { hasModule } from '../utils/modules';
import type { Contract, ContractSummary, Paginated } from '../types';
import { autoCdi, contractLabel } from '../utils/contracts';

const DAY = 86_400_000;
const utcDay = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z');
const STORAGE_KEY = 'contract-notif-seen';
const fmtDate = (d: string) => d.slice(0, 10).split('-').reverse().join('/');

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

/** The contract's elapsed share, overdue days in red — same reading as the Contrats page. */
function MiniBar({ c }: { c: Contract }) {
  if (!c.end_date || c.days_left === null) return null;
  const total = Math.max(1, Math.round((utcDay(c.end_date) - utcDay(c.start_date)) / DAY) + 1);
  const late = c.days_left < 0 ? -c.days_left : 0;
  const done = late ? (total / (total + late)) * 100 : Math.min(100, ((total - c.days_left) / total) * 100);

  return (
    <div className="mt-2 flex h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={clsx('h-full', late ? 'bg-slate-400 dark:bg-slate-500' : 'bg-amber-500')} style={{ width: `${done}%` }} />
      {late > 0 && <div className="h-full bg-red-500" style={{ width: `${Math.max(4, 100 - done)}%` }} />}
    </div>
  );
}

function statusText(c: Contract) {
  const d = c.days_left ?? 0;
  if (d < 0) return `Terminé depuis ${-d} j`;
  if (d === 0) return "Se termine aujourd'hui";
  return autoCdi(c) ? `CDI auto dans ${d} j` : `Fin dans ${d} j`;
}

const pushHints: Record<PushStatus, string> = {
  on: 'Activées : les alertes arrivent sur cet appareil, même application fermée.',
  off: 'Recevez les alertes de contrats directement sur cet appareil.',
  denied: 'Bloquées par le navigateur. Autorisez les notifications pour ce site dans ses réglages, puis réessayez.',
  'ios-install': "Sur iPhone / iPad : touchez Partager › « Sur l'écran d'accueil », ouvrez l'application depuis son icône, puis activez ici.",
  unsupported: 'Ce navigateur ne prend pas en charge les notifications (une connexion HTTPS est nécessaire).',
};

function Switch({ checked, disabled, busy, onChange }: { checked: boolean; disabled?: boolean; busy?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Notifications sur cet appareil"
      disabled={disabled || busy}
      onClick={onChange}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700',
      )}
    >
      <span
        className={clsx(
          'inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform dark:bg-slate-200',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      >
        {busy && <Loader2 size={12} className="animate-spin text-slate-500" />}
      </span>
    </button>
  );
}

function DeviceToggle() {
  const push = usePushNotifications();
  const on = push.status === 'on';
  const blocked = push.status === 'denied' || push.status === 'ios-install' || push.status === 'unsupported';

  return (
    <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="flex items-center gap-3">
        <Smartphone size={16} className="shrink-0 text-slate-400 dark:text-slate-500" />
        <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">Notifications sur cet appareil</span>
        <Switch checked={on} disabled={blocked} busy={push.busy} onChange={() => (on ? push.disable() : push.enable())} />
      </div>
      <p className={clsx('mt-1.5 pl-7 text-xs leading-relaxed', push.error ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400')}>
        {push.error ?? pushHints[push.status]}
      </p>
    </div>
  );
}

/**
 * Bell in the top bar: contracts ending within `alert_days` or already ended
 * (Contrats session). The panel opens by itself on the Dashboard once a day —
 * and again whenever the counts change — and from the bell anywhere else.
 * Its footer switches device notifications (Web Push) on for this device.
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
    refetchInterval: 60_000,
  });
  const summary = summaryQuery.data;
  const count = (summary?.bientot ?? 0) + (summary?.termine ?? 0);

  const listQuery = useQuery({
    queryKey: ['contracts', 'notifications', siteParams],
    queryFn: () =>
      api
        .get<Paginated<Contract>>('/contracts', { params: { ...siteParams, state: 'a_traiter', per_page: 6 } })
        .then((r) => r.data),
    enabled: enabled && (open || count > 0),
  });

  // Keep this device registered on the server (once per account / app start)…
  const userId = user?.id;
  useEffect(() => {
    if (enabled && userId) syncPushSubscription().catch(() => undefined);
  }, [enabled, userId]);

  // …and refresh the bell the instant a notification reaches this device.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || !('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'push-received') {
        queryClient.invalidateQueries({ queryKey: ['contracts-summary'] });
        queryClient.invalidateQueries({ queryKey: ['contracts'] });
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [enabled, queryClient]);

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
  const total = listQuery.data?.total ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        className={clsx(
          'relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
          open && 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
        )}
        aria-label={count > 0 ? `Notifications : ${count} contrat(s) à traiter` : 'Notifications'}
        aria-expanded={open}
        title={count > 0 ? `${count} contrat(s) à traiter` : 'Aucune notification'}
      >
        <Bell size={20} />
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white dark:ring-slate-900">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
        {/* Phone: dims the page; a tap outside closes the panel. */}
        <div className="fixed inset-0 z-40 bg-slate-900/40 sm:hidden" onClick={close} aria-hidden />
        {/*
          Phone (< sm): a sheet pinned under the top bar with 12px margins on
          both sides, whatever sits next to the bell, below the iPhone notch
          (safe-area), never taller than the screen — the list scrolls, the
          device switch stays visible. Tablet / desktop: dropdown under the bell.
        */}
        <div className="animate-notif-in fixed inset-x-3 top-[calc(4.5rem+env(safe-area-inset-top))] z-50 flex max-h-[calc(100dvh-5.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] origin-top flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:max-h-[calc(100dvh-5rem)] sm:w-96 sm:origin-top-right">
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notifications</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Contrats à traiter</p>
            </div>
            <div className="flex items-center gap-1.5">
              {(summary?.termine ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25">
                  {summary?.termine} terminé{(summary?.termine ?? 0) > 1 ? 's' : ''}
                </span>
              )}
              {(summary?.bientot ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25">
                  {summary?.bientot} bientôt
                </span>
              )}
              <button
                onClick={close}
                className="ml-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* List */}
          {count === 0 ? (
            <div className="flex shrink-0 flex-col items-center gap-2 px-6 py-8 text-center">
              <CheckCircle2 size={26} className="text-emerald-500" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Tout est à jour</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Aucun contrat ne se termine dans les {summary?.alert_days ?? 10} prochains jours.
              </p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto overscroll-contain dark:divide-slate-800 sm:max-h-[420px]">
              {rows.map((c) => {
                const late = (c.days_left ?? 0) < 0;
                return (
                  <li key={c.id}>
                    <Link
                      to="/contrats?state=a_traiter"
                      onClick={close}
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <span
                        className={clsx(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          late ? 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400' : 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
                        )}
                      >
                        {late ? <AlertCircle size={16} /> : <Clock size={16} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{c.employee?.full_name}</span>
                          <span
                            className={clsx(
                              'shrink-0 text-xs font-medium',
                              late ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400',
                            )}
                          >
                            {statusText(c)}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                          {[contractLabel(c), c.employee?.site?.name, c.end_date ? `fin le ${fmtDate(c.end_date)}` : null].filter(Boolean).join(' · ')}
                        </div>
                        <MiniBar c={c} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer */}
          <Link
            to="/contrats?state=a_traiter"
            onClick={close}
            className="flex shrink-0 items-center justify-center gap-1.5 border-t border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/50"
          >
            {total > rows.length ? `Voir les ${total} contrats` : 'Ouvrir les contrats'}
            <ArrowRight size={15} />
          </Link>
          <DeviceToggle />
        </div>
        </>
      )}
    </div>
  );
}
