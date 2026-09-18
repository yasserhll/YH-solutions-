import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import toast from 'react-hot-toast';
import { WifiOff, DownloadCloud, RefreshCw } from 'lucide-react';

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
 * existing 30-minute poll (`onRegisteredSW`) still re-checks for updates on
 * a long-lived tab, so a shipped fix can't go unnoticed the way an ephemeral
 * toast could.
 */
export function PwaStatus() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
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
        if (!registration) return;
        setInterval(() => registration.update(), 30 * 60 * 1000);

        // The 30-minute poll alone is too slow for how this app is actually
        // used on a tablet or as an installed PWA: it's backgrounded and
        // foregrounded constantly rather than closed, so a deploy made while
        // it sat in the background could otherwise go unnoticed for up to
        // half an hour. Checking again the moment it comes back to the
        // foreground (switching back to the tab, reopening the installed
        // app, unlocking the tablet) catches that case immediately instead.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update();
        });
      },
    });
    updateSWRef.current = updateSW;

    function goOffline() {
      setIsOffline(true);
    }
    function goOnline() {
      setIsOffline(false);
      toast.success('Connexion rétablie — synchronisation en cours...', { duration: 3000 });
    }
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  function reloadForUpdate() {
    updateSWRef.current?.(true);
  }

  if (!isOffline && !needRefresh) return null;

  return (
    <>
      {isOffline && (
        <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 py-1.5 text-xs font-medium text-white shadow">
          <WifiOff size={13} />
          Hors connexion — vous consultez les dernières données enregistrées, vos actions seront synchronisées au retour du réseau.
        </div>
      )}
      {needRefresh && (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center justify-center gap-3 border-t border-sky-300/20 bg-sky-500/10 px-4 py-3 text-sm font-medium text-white shadow-lg backdrop-blur-sm">
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
