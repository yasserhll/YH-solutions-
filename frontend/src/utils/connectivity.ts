/**
 * Is the SERVER reachable right now — not just "does the phone have a
 * network" (`navigator.onLine` says true on a Wi-Fi without internet, and
 * on iOS briefly says false after the app is reopened, which showed the
 * "Hors connexion" banner for no reason). The banner follows a real check:
 * `GET /api/ping` (never answered by the service worker's cache).
 *
 * Signals that something may be wrong (an `offline` event, an API call that
 * got no answer, a page served from the offline copy) only trigger a check;
 * the state changes on the check's result. While offline it re-checks every
 * 5 s, and at once when the app comes back to the foreground.
 */
type State = { online: boolean; queued: number };

let state: State = { online: true, queued: 0 };
const listeners = new Set<(s: State) => void>();

function set(patch: Partial<State>) {
  const next = { ...state, ...patch };
  if (next.online === state.online && next.queued === state.queued) return;
  const cameBack = next.online && !state.online;
  state = next;
  listeners.forEach((l) => l(state));
  if (cameBack) askServiceWorker('flush-offline-queue');
}

export function getConnectivity(): State {
  return state;
}

export function subscribeConnectivity(listener: (s: State) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setQueuedCount(queued: number) {
  set({ queued });
}

export function askServiceWorker(type: string) {
  navigator.serviceWorker?.controller?.postMessage({ type });
}

let checking: Promise<boolean> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Pings the server; updates the state. Concurrent calls share one ping. */
export function checkConnectivity(): Promise<boolean> {
  if (checking) return checking;
  checking = (async () => {
    let ok = false;
    // Two tries: one lost packet must not flip the banner.
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`/api/ping?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
        ok = res.ok;
      } catch {
        ok = false;
      } finally {
        clearTimeout(timer);
      }
    }
    set({ online: ok });
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = ok ? null : setTimeout(() => void checkConnectivity(), 5000);
    return ok;
  })().finally(() => (checking = null));
  return checking;
}

/** An API call came back from the server: proof enough that it's reachable. */
export function reportServerReached() {
  if (!state.online) set({ online: true });
}

/** An API call got no answer, or an offline copy: verify, don't assume. */
export function reportServerUnreachable() {
  void checkConnectivity();
}
