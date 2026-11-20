import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CloudOff, RefreshCw, CloudUpload, X } from 'lucide-react';
import clsx from 'clsx';
import { checkConnectivity, getConnectivity, subscribeConnectivity } from '../utils/connectivity';

export function useConnectivity() {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);
}

/**
 * Connection state as a small chip in the top bar, next to the bell — like
 * a native app's status, never a bar on top of the navigation (the old
 * full-width banner covered the header). Hidden when online with nothing
 * waiting. Tap it for the explanation and a "Réessayer".
 */
export function ConnectionStatus() {
  const { online, queued } = useConnectivity();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  if (online && queued === 0) return null;

  const pending = queued === 1 ? '1 action en attente' : `${queued} actions en attente`;
  const retry = async () => {
    setChecking(true);
    await checkConnectivity();
    setChecking(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={online ? `Envoi en cours, ${pending}` : 'Hors connexion'}
        className={clsx(
          'flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset transition-colors',
          online
            ? 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30'
            : 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
        )}
      >
        {online ? <CloudUpload size={15} className="animate-pulse" /> : <CloudOff size={15} />}
        <span className="hidden sm:inline">{online ? 'Envoi…' : 'Hors ligne'}</span>
        {queued > 0 && (
          <span
            className={clsx(
              'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] leading-none text-white',
              online ? 'bg-sky-600' : 'bg-amber-600',
            )}
          >
            {queued}
          </span>
        )}
      </button>

      {open && (
        <div className="animate-notif-in fixed inset-x-3 top-[calc(4.5rem+env(safe-area-inset-top))] z-50 origin-top rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-80 sm:origin-top-right">
          <div className="mb-2 flex items-start gap-2">
            <span
              className={clsx(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                online ? 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400' : 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
              )}
            >
              {online ? <CloudUpload size={16} /> : <CloudOff size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900 dark:text-slate-100">{online ? 'Envoi en cours' : 'Mode hors connexion'}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{queued > 0 ? pending : 'Rien en attente'}</div>
            </div>
            <button onClick={() => setOpen(false)} className="-m-1 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
              <X size={16} />
            </button>
          </div>
          <p className="text-slate-600 dark:text-slate-300">
            {online
              ? 'Les actions faites sans réseau sont envoyées au serveur, une par une, sans doublon.'
              : 'Continuez à travailler normalement : vos saisies restent sur l’appareil et partent toutes seules au retour du réseau. Les listes affichent les données de votre dernière connexion.'}
          </p>
          {!online && (
            <button
              type="button"
              onClick={retry}
              disabled={checking}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw size={14} className={clsx(checking && 'animate-spin')} />
              {checking ? 'Vérification…' : 'Réessayer maintenant'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
