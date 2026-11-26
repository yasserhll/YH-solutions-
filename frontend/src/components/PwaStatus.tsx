import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { DownloadCloud, PauseCircle, RefreshCw, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import {
  askServiceWorker,
  checkConnectivity,
  getConnectivity,
  setQueuedCount,
  subscribeConnectivity,
} from '../utils/connectivity';
import { openWindowCount } from '../hooks/useBackClose';

type SyncFailure = { method: string; url: string; status?: number; message: string };

/** Id of the build this page runs (vite.config.ts `define`); the deployed one is in /version.json. */
declare const __BUILD_ID__: string;

/**
 * How often an open app asks the server which build is deployed. One tiny
 * no-cache request (answered 304 almost always). The user's rule (2026-11-20):
 * a deploy must show RECHARGER to everyone at once — browser, desktop PWA,
 * Android, iPhone — so this is seconds, never minutes. A hidden / suspended
 * app (iPhone in the background) can't run code: it checks the instant it
 * comes back to the foreground.
 */
const VERSION_POLL_MS = 5_000;
/** The update banner reloads by itself after this countdown (user's rule, 2026-11-26), unless a form is open. */
const AUTO_RELOAD_SECONDS = 5;

type HoldReason = 'form' | 'typing' | 'offline';
const holdMessages: Record<HoldReason, string> = {
  form: 'Rechargement dès que la fenêtre ouverte sera fermée.',
  typing: 'Rechargement dès que vous aurez fini de taper.',
  offline: 'Rechargement dès que la connexion revient.',
};
/** Last time something was typed in a field (any page): a reload right then would lose it. */
let lastTypedAt = 0;
const TYPING_GRACE_MS = 4000;
if (typeof document !== 'undefined') {
  document.addEventListener('input', () => (lastTypedAt = Date.now()), { capture: true, passive: true });
}
function currentHoldReason(): HoldReason | null {
  if (openWindowCount() > 0) return 'form';
  if (Date.now() - lastTypedAt < TYPING_GRACE_MS) return 'typing';
  if (!getConnectivity().online) return 'offline';
  return null;
}

/** Resolves once the registration has a waiting (installed) worker, or after `timeoutMs`. */
function waitForWaitingWorker(registration: ServiceWorkerRegistration, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (registration.waiting || Date.now() > end) return resolve();
      setTimeout(tick, 200);
    };
    tick();
  });
}

/**
 * RECHARGER is offered ONCE per deployed build (the user's rule, 2026-11-24):
 * once clicked it must not come back for that same build — not while the new
 * worker downloads, not after the reload. sessionStorage survives the reload.
 */
const APPLIED_KEY = 'update-applied-build';
const RETRIED_KEY = 'update-retried-build';
function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* private mode: worst case the banner may be offered again */
  }
}

/** The build deployed on the server right now, or null when it can't be known (offline…). */
async function deployedBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const { build } = (await res.json()) as { build?: string };
    return build || null;
  } catch {
    return null;
  }
}

/** Removes the service worker and reloads from the network: always lands on the deployed build. */
async function unregisterAndReload() {
  const registrations = await navigator.serviceWorker?.getRegistrations();
  await Promise.all((registrations ?? []).map((r) => r.unregister()));
  window.location.reload();
}

/**
 * Registers the service worker and surfaces the things a user actually needs
 * to know about a PWA: "you're offline, your changes will sync later" and
 * "a new version is ready". Mount once, near the root.
 *
 * Updates are user-triggered via a persistent bottom banner (RECHARGER), at
 * the user's explicit request — not applied silently. `onNeedRefresh` just
 * flips `needRefresh`; the banner's button is what actually calls
 * `updateSW(true)`, which activates the waiting service worker and reloads
 * the page for the new version — the same effect as a hard refresh, but
 * going through the proper PWA update path (skip-waiting + controllerchange)
 * rather than a plain `location.reload()`, which wouldn't hand control to
 * the new worker on its own. The banner is persistent (not a toast) and the
 * 30-second poll (`onRegisteredSW`, plus focus / foreground) re-checks for updates on
 * a long-lived tab, so a shipped fix can't go unnoticed the way an ephemeral
 * toast could.
 */
export function PwaStatus() {
  const queryClient = useQueryClient();
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  // Set the moment RECHARGER is clicked: nothing may show the banner again on this page.
  const updatingRef = useRef(false);
  // The deployed build the banner is offering (null: only the SW knows of an update).
  const offeredBuildRef = useRef<string | null>(null);

  useEffect(() => {
    /**
     * Shows RECHARGER for `build`, unless it was already clicked for that
     * build. If it was, and the page still runs the old build after the
     * reload (an old worker served its stale copy), finish the update
     * silently once instead of asking again. Returns whether it was shown.
     */
    function offerUpdate(build: string | null): boolean {
      if (updatingRef.current) return false;
      if (build && readSession(APPLIED_KEY) === build) {
        if (readSession(RETRIED_KEY) !== build) {
          writeSession(RETRIED_KEY, build);
          updatingRef.current = true;
          void unregisterAndReload();
        }
        return false;
      }
      offeredBuildRef.current = build;
      setNeedRefresh(true);
      return true;
    }

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        void (async () => {
          const build = await deployedBuild();
          // This page already runs the deployed build (e.g. just reloaded):
          // nothing to offer — the waiting worker takes over on its own later.
          if (build === __BUILD_ID__) return;
          offerUpdate(build);
        })();
      },
      onOfflineReady() {
        toast.success('Application prête pour un usage hors connexion.', {
          icon: <DownloadCloud size={16} />,
          duration: 4000,
        });
      },
      onRegisterError(error) {
        console.error('Service worker registration failed', error);
      },
      onRegisteredSW(_url, registration) {
        // A long-lived tab (this is the kind of app people leave open all
        // day) otherwise only checks for a new version on navigation —
        // poll too, so the RECHARGER banner can appear without anyone
        // needing to close the tab first.
        // A deploy must be offered within seconds, not after half an
        // hour: check every 30 s (one small request for sw.js, the browser
        // bypasses its HTTP cache for it), and at once whenever the app
        // comes back to the foreground, gets the focus or the network.
        // Throttled so these triggers never pile up.
        if (!registration) return;
        let lastCheck = 0;
        const checkForUpdate = () => {
          if (Date.now() - lastCheck < 10_000 || !navigator.onLine) return;
          lastCheck = Date.now();
          registration.update().catch(() => undefined);
        };
        setInterval(checkForUpdate, 30_000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });
        window.addEventListener('focus', checkForUpdate);
        window.addEventListener('online', checkForUpdate);
      },
    });
    updateSWRef.current = updateSW;

    // Instant update offer: the server's /version.json names the deployed
    // build. As soon as it differs from this page's build, show RECHARGER
    // (the new service worker is fetched in the background meanwhile;
    // reloadForUpdate waits for it). Independent of the service worker, so it
    // also works where none can register (some in-app browsers).
    let versionCheckRunning = false;
    const checkDeployedVersion = async () => {
      if (import.meta.env.DEV || versionCheckRunning || updatingRef.current || document.visibilityState !== 'visible') return;
      versionCheckRunning = true;
      try {
        const build = await deployedBuild();
        if (!build) return; // no network: checked again on the next tick / when it comes back
        if (build === __BUILD_ID__) {
          // Running the deployed build: the update (if any) is done.
          writeSession(APPLIED_KEY, null);
          writeSession(RETRIED_KEY, null);
          return;
        }
        if (offerUpdate(build)) {
          navigator.serviceWorker
            ?.getRegistration()
            .then((registration) => registration?.update())
            .catch(() => undefined);
        }
      } finally {
        versionCheckRunning = false;
      }
    };
    void checkDeployedVersion();
    const versionTimer = window.setInterval(checkDeployedVersion, VERSION_POLL_MS);
    const onVersionVisible = () => {
      if (document.visibilityState === 'visible') void checkDeployedVersion();
    };
    document.addEventListener('visibilitychange', onVersionVisible);
    window.addEventListener('focus', checkDeployedVersion);
    window.addEventListener('online', checkDeployedVersion);
    // iOS restores a PWA from its page cache without a reload: check then too.
    window.addEventListener('pageshow', checkDeployedVersion);

    // Connectivity: a real check of the server, not navigator.onLine alone
    // (see utils/connectivity.ts). The browser's events only trigger it.
    let wasOnline = getConnectivity().online;
    const unsubscribe = subscribeConnectivity((next) => {
      if (!next.online && wasOnline) {
        toast('Mode hors connexion : vous pouvez continuer à travailler, tout sera envoyé au retour du réseau.', {
          id: 'offline',
          icon: '📶',
          duration: 4000,
        });
      }
      if (next.online && !wasOnline) {
        // Back online: refetch what was shown from the offline copy.
        queryClient.invalidateQueries();
        if (next.queued === 0) toast.success('Connexion rétablie.', { id: 'online', duration: 2500 });
      }
      wasOnline = next.online;
    });
    const check = () => void checkConnectivity();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!getConnectivity().online) check();
      askServiceWorker('flush-offline-queue');
    };
    window.addEventListener('offline', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', onVisible);
    if (!navigator.onLine) check();

    // The service worker's write queue: how many actions wait, and what
    // happened when they were sent.
    function onSwMessage(event: MessageEvent) {
      const data = event.data as { type?: string; count?: number; sent?: number; failed?: SyncFailure[]; remaining?: number };
      if (data?.type === 'offline-queue') setQueuedCount(data.count ?? 0);
      if (data?.type === 'offline-sync') {
        setQueuedCount(data.remaining ?? 0);
        if (data.sent) {
          toast.success(
            data.sent === 1 ? '1 action faite hors connexion a été envoyée.' : `${data.sent} actions faites hors connexion ont été envoyées.`,
            { id: 'offline-sync', duration: 4000 },
          );
        }
        (data.failed ?? []).forEach((f, i) =>
          toast.error(`Action hors connexion refusée par le serveur : ${f.message}`, { id: `offline-failed-${Date.now()}-${i}`, duration: 10000 }),
        );
        queryClient.invalidateQueries();
      }
    }
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    // App (re)opened: send whatever was left waiting, and show the count.
    navigator.serviceWorker?.ready.then(() => {
      askServiceWorker('offline-queue-status');
      askServiceWorker('flush-offline-queue');
    });

    return () => {
      unsubscribe();
      window.removeEventListener('offline', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
      window.clearInterval(versionTimer);
      document.removeEventListener('visibilitychange', onVersionVisible);
      window.removeEventListener('focus', checkDeployedVersion);
      window.removeEventListener('online', checkDeployedVersion);
      window.removeEventListener('pageshow', checkDeployedVersion);
    };
  }, []);

  async function reloadForUpdate() {
    // Hide the banner the instant the button is clicked — it should never
    // look like the click did nothing, whatever happens next.
    setNeedRefresh(false);
    // …and never again for this build: not during the download, not after the reload.
    updatingRef.current = true;
    const build = offeredBuildRef.current ?? (await deployedBuild());
    if (build) writeSession(APPLIED_KEY, build);

    let reloaded = false;
    const hardReload = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    // The proper path: message whatever SW is actually waiting right now
    // (fetched fresh, not a possibly-stale reference) to skip waiting, then
    // reload once 'controllerchange' confirms it actually took control.
    navigator.serviceWorker?.addEventListener('controllerchange', hardReload, { once: true });
    const registration = await navigator.serviceWorker?.getRegistration();
    // The banner now appears as soon as /version.json changes, possibly
    // before the new service worker has finished downloading: wait for it
    // (a few seconds at most), so the switch takes the proper path below
    // rather than the unregister fallback.
    if (registration && !registration.waiting) {
      toast.loading('Mise à jour en cours…', { id: 'sw-update' });
      registration.update().catch(() => undefined);
      await waitForWaitingWorker(registration, 20_000);
    }
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    updateSWRef.current?.(true);

    // Guaranteed fallback if that handoff never completes (a real,
    // previously-reported failure mode — a known workbox-window gap, worse
    // on Safari/iOS and some installed-PWA webviews). Naively falling back
    // to a plain reload here does NOT help: this app's navigateFallback
    // means EVERY navigation, reload included, is intercepted by whichever
    // service worker is currently active and answered from its OWN
    // precache — so a plain reload while the old, stuck worker is still
    // active just re-serves that same stale shell, looking exactly like
    // the click did nothing. Unregistering first removes that interception
    // entirely, so this fallback reload is a genuine uncached network
    // request that always lands on the current build (a fresh SW registers
    // again on that load, same as any first visit).
    setTimeout(async () => {
      if (reloaded) return;
      reloaded = true;
      await unregisterAndReload();
    }, 2000);
  }

  // RECHARGER runs by itself once the 5-second countdown ends (user's rule,
  // 2026-11-26: it must really reload, not stay on screen). It waits only
  // where a reload would lose something: a form / modal / the scanner open,
  // a field typed into in the last few seconds, or no network (the new
  // version can't be fetched). The menu and the notifications panel never
  // hold it. Actions waiting to be sent don't either: they live in the
  // service worker's queue (IndexedDB), which a reload keeps and replays.
  const [countdown, setCountdown] = useState(AUTO_RELOAD_SECONDS);
  const [holdReason, setHoldReason] = useState<HoldReason | null>(null);
  const reloadRef = useRef(reloadForUpdate);
  reloadRef.current = reloadForUpdate;
  useEffect(() => {
    if (!needRefresh) return;
    const started = Date.now();
    setCountdown(AUTO_RELOAD_SECONDS);
    setHoldReason(null);
    const tick = () => {
      const left = Math.max(0, AUTO_RELOAD_SECONDS - Math.floor((Date.now() - started) / 1000));
      setCountdown(left);
      if (left > 0) return;
      const reason = currentHoldReason();
      setHoldReason(reason);
      if (reason) return;
      window.clearInterval(timer);
      void reloadRef.current();
    };
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [needRefresh]);

  // Connection state is the chip in the top bar (ConnectionStatus) — never a
  // bar over the navigation. Only the update offer is drawn here: a
  // persistent floating card (not a toast, so it can't be missed).
  if (!needRefresh) return null;

  const holding = countdown === 0 && holdReason !== null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center safe-px pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div
        role="status"
        aria-live="polite"
        className="animate-notif-in pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-xl shadow-slate-900/15 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-black/50"
      >
        <div className="flex items-center gap-3 p-3 pl-3.5">
          <CountdownRing seconds={countdown} total={AUTO_RELOAD_SECONDS} holding={holding} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Sparkles size={14} className="shrink-0 text-sky-500" />
              Nouvelle version disponible
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {countdown > 0 ? (
                <>
                  Rechargement automatique dans{' '}
                  <span key={countdown} className="animate-count-pop inline-block font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                    {countdown} s
                  </span>
                </>
              ) : holding ? (
                <span className="text-amber-600 dark:text-amber-400">{holdMessages[holdReason!]}</span>
              ) : (
                'Rechargement…'
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={reloadForUpdate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-500 active:bg-sky-700"
          >
            <RefreshCw size={14} className={countdown === 0 && !holding ? 'animate-spin' : undefined} />
            Recharger
          </button>
        </div>
        {/* Drains over the 5 seconds, from full to empty. */}
        <div className="h-1 w-full bg-slate-100 dark:bg-slate-800">
          <div
            key={String(needRefresh)}
            className={clsx(
              'h-full origin-left',
              holding ? 'animate-pulse bg-amber-400' : 'animate-update-bar bg-gradient-to-r from-sky-500 to-emerald-400',
            )}
            style={{ animationDuration: holding ? undefined : `${AUTO_RELOAD_SECONDS}s` }}
          />
        </div>
      </div>
    </div>
  );
}

/** Circular countdown: the ring empties over `total` seconds, the number in the middle. */
function CountdownRing({ seconds, total, holding }: { seconds: number; total: number; holding: boolean }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-10 w-10 -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="3.5" className="stroke-sky-100 dark:stroke-sky-500/15" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          className={holding ? 'animate-pulse stroke-amber-400' : 'animate-update-ring stroke-sky-500'}
          style={{ ['--ring-c' as string]: `${c}px`, animationDuration: holding ? undefined : `${total}s` }}
        />
      </svg>
      {seconds > 0 ? (
        <span key={seconds} className="animate-count-pop relative text-sm font-bold tabular-nums text-sky-600 dark:text-sky-400">
          {seconds}
        </span>
      ) : holding ? (
        <PauseCircle size={16} className="relative text-amber-500" />
      ) : (
        <RefreshCw size={15} className="relative animate-spin text-sky-500" />
      )}
    </span>
  );
}
