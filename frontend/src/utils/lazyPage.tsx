import { lazy, type ComponentType } from 'react';

/**
 * A page loaded in its own file, so the app starts without downloading and
 * running every module at once (one 1.4 MB file before this). Unlike a bare
 * React.lazy, once the file is loaded the page renders directly — no
 * "Chargement…" flash — and `preloadPages()` loads them all in the
 * background right after start-up, so a click on the menu is instant.
 */
type Page = ComponentType & { preload: () => Promise<unknown> };

const registry: Page[] = [];
const RELOAD_KEY = 'page-chunk-reload';

// The new version loaded fine: allow the auto-reload again next time.
try {
  setTimeout(() => sessionStorage.removeItem(RELOAD_KEY), 10_000);
} catch {
  /* ignore */
}

function PageUnavailable() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      Cette page n’a pas encore été chargée sur cet appareil et la connexion est coupée. Elle s’ouvrira dès le retour du réseau.
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage(load: () => Promise<{ default: ComponentType<any> }>): Page {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Loaded: ComponentType<any> | null = null;
  let pending: Promise<{ default: ComponentType }> | null = null;
  const preload = () =>
    (pending ??= load().then((m) => {
      Loaded = m.default;
      return m;
    }).catch((e) => {
      pending = null; // a failed download (offline) may be retried
      throw e;
    }));
  const Lazy = lazy(() =>
    preload().catch(() => {
      // A tab opened before a deploy asks for a file the new version no
      // longer has: reload once onto the new version. Offline (or the
      // reload already tried): a message instead of a blank screen.
      try {
        if (navigator.onLine && !sessionStorage.getItem(RELOAD_KEY)) {
          sessionStorage.setItem(RELOAD_KEY, '1');
          window.location.reload();
          return new Promise<never>(() => undefined);
        }
      } catch {
        /* storage blocked */
      }
      return { default: PageUnavailable };
    }),
  );
  const Page = (() => (Loaded ? <Loaded /> : <Lazy />)) as unknown as Page;
  Page.preload = preload;
  registry.push(Page);
  return Page;
}

/** Loads every page in the background, one after the other, when the browser is idle. */
export function preloadPages() {
  const idle = (cb: () => void) =>
    'requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1200);
  idle(async () => {
    for (const page of registry) {
      try {
        await page.preload();
      } catch {
        /* offline / not yet precached: loaded on first visit instead */
      }
    }
  });
}
