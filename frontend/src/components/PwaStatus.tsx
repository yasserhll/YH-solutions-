import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { DownloadCloud, RefreshCw, Sparkles } from 'lucide-react';
import {
  askServiceWorker,
  checkConnectivity,
  getConnectivity,
  setQueuedCount,
  subscribeConnectivity,
} from '../utils/connectivity';

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

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
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
      if (import.meta.env.DEV || versionCheckRunning || document.visibilityState !== 'visible') return;
      versionCheckRunning = true;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (build && build !== __BUILD_ID__) {
          setNeedRefresh(true);
          navigator.serviceWorker
            ?.getRegistration()
            .then((registration) => registration?.update())
            .catch(() => undefined);
        }
      } catch {
        /* no network: checked again on the next tick / when it comes back */
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
      const registrations = await navigator.serviceWorker?.getRegistrations();
      await Promise.all((registrations ?? []).map((r) => r.unregister()));
      hardReload();
    }, 2000);
  }

  // Connection state is the chip in the top bar (ConnectionStatus) — never a
  // bar over the navigation. Only the update offer is drawn here: a
  // persistent floating card (not a toast, so it can't be missed).
  if (!needRefresh) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center safe-px pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="animate-notif-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 pl-4 shadow-xl shadow-slate-900/15 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-black/50">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400">
          <Sparkles size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Nouvelle version disponible</div>
          <div className="truncate text-xs text-slate-500 dark:text-slate-400">Rechargez pour profiter des nouveautés.</div>
        </div>
        <button
          type="button"
          onClick={reloadForUpdate}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-500 active:bg-sky-700"
        >
          <RefreshCw size={14} />
          Recharger
        </button>
      </div>
    </div>
  );
}
