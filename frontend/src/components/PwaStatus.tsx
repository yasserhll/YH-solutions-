import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import toast from 'react-hot-toast';
import { WifiOff, RefreshCw, DownloadCloud } from 'lucide-react';

/**
 * Registers the service worker and surfaces the two things a user actually
 * needs to know about a PWA: "you're offline, your changes will sync later"
 * and "a new version is ready, reload when convenient". Mount once, near
 * the root — has no visual footprint beyond toasts/the offline banner.
 */
export function PwaStatus() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        toast(
          (t) => (
            <div className="flex items-center gap-3">
              <span className="text-sm">Nouvelle version disponible.</span>
              <button
                onClick={() => {
                  toast.dismiss(t.id);
                  updateSW(true);
                }}
                className="flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-white dark:text-slate-900"
              >
                <RefreshCw size={12} /> Mettre à jour
              </button>
            </div>
          ),
          { duration: Infinity, id: 'pwa-update' }
        );
      },
      onOfflineReady() {
        toast.success("Application prête pour un usage hors connexion.", {
          icon: <DownloadCloud size={16} />,
          duration: 4000,
        });
      },
      onRegisterError(error) {
        console.error('Service worker registration failed', error);
      },
    });

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

  if (!isOffline) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 py-1.5 text-xs font-medium text-white shadow">
      <WifiOff size={13} />
      Hors connexion — vous consultez les dernières données enregistrées, vos actions seront synchronisées au retour du réseau.
    </div>
  );
}
