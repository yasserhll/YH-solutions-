import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import toast from 'react-hot-toast';
import { WifiOff, DownloadCloud } from 'lucide-react';

/**
 * Registers the service worker and surfaces the two things a user actually
 * needs to know about a PWA: "you're offline, your changes will sync later"
 * and "you're now on the latest version". Mount once, near the root — has
 * no visual footprint beyond toasts/the offline banner.
 *
 * Updates are applied automatically (no "click to update" prompt): this app
 * changes constantly, and leaving a fix sitting inert on an already-open tab
 * or an already-installed device until someone notices a toast is worse than
 * an occasional automatic reload. See onNeedRefresh below.
 */
export function PwaStatus() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        toast.loading('Mise à jour de l\'application...', { id: 'pwa-update', duration: 2000 });
        updateSW(true);
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
        // poll too, so a fix ships without anyone needing to close the tab.
        if (!registration) return;
        setInterval(() => registration.update(), 30 * 60 * 1000);
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
