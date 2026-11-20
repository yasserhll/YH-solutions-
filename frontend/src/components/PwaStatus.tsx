import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { WifiOff, DownloadCloud, RefreshCw, CloudUpload } from 'lucide-react';
import {
  askServiceWorker,
  checkConnectivity,
  getConnectivity,
  setQueuedCount,
  subscribeConnectivity,
} from '../utils/connectivity';

type SyncFailure = { method: string; url: string; status?: number; message: string };

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
  const [conn, setConn] = useState(getConnectivity);
  const isOffline = !conn.online;
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

    // Connectivity: a real check of the server, not navigator.onLine alone
    // (see utils/connectivity.ts). The browser's events only trigger it.
    let wasOnline = getConnectivity().online;
    const unsubscribe = subscribeConnectivity((next) => {
      setConn(next);
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

  const syncing = !isOffline && conn.queued > 0;
  const pending = conn.queued === 1 ? '1 action en attente d’envoi' : `${conn.queued} actions en attente d’envoi`;

  if (!isOffline && !needRefresh && !syncing) return null;

  return (
    <>
      {isOffline && (
        <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 safe-px pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-xs font-medium text-white shadow">
          <WifiOff size={13} className="shrink-0" />
          <span>
            Hors connexion — vous consultez les dernières données enregistrées, vos actions seront envoyées au retour du réseau.
            {conn.queued > 0 && <strong className="ml-1">({pending})</strong>}
          </span>
        </div>
      )}
      {syncing && (
        <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-sky-600 safe-px pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-xs font-medium text-white shadow">
          <CloudUpload size={13} className="shrink-0 animate-pulse" />
          Envoi des actions faites hors connexion… ({pending})
        </div>
      )}
      {needRefresh && (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center justify-center gap-3 border-t border-sky-300/20 bg-sky-500/10 safe-px pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-sm font-medium text-white shadow-lg backdrop-blur-sm">
          <RefreshCw size={16} className="shrink-0 text-sky-300" />
          <span>Une nouvelle version est disponible.</span>
          <button
            type="button"
            onClick={reloadForUpdate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-sky-500 to-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-blue-950/40 ring-1 ring-inset ring-white/10 transition-colors hover:from-sky-400 hover:to-blue-500"
          >
            <RefreshCw size={13} />
            Recharger
          </button>
        </div>
      )}
    </>
  );
}
