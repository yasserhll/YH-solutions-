/*
 * Offline support for every /api/* call, imported into the Workbox service
 * worker (vite.config.ts -> workbox.importScripts). Workbox only precaches
 * the app shell; the API is handled entirely here:
 *
 * READS (GET): network first. The cached copy is used only when the network
 *   really fails, or is still silent after 10 s (and a copy exists) — it is
 *   then tagged `X-From-Cache: 1` so the page knows it is showing saved data.
 *   The cache is per session (key = URL + hash of the token): another account
 *   on the same phone never sees these copies.
 *
 * WRITES (POST/PUT/PATCH/DELETE): sent normally. Only when the network fails
 *   is the request saved in IndexedDB and answered `202 {queued: true}` with
 *   `X-Offline-Queued: 1`, so the form closes as if saved instead of showing
 *   an error. Each request carries the X-Idempotency-Key set by api/client.ts:
 *   the queue holds it at most once, and the server (EnsureIdempotentWrites)
 *   runs it at most once even if it is replayed after its first response was
 *   lost. Replay = in order, one at a time, a single replay running at once,
 *   triggered by Background Sync (Android/desktop), by any page message
 *   ("flush-offline-queue": network back, app reopened) and by the next API
 *   response that comes back from the network.
 */
const API_CACHE = 'api-get-v2';
const DB_NAME = 'offline-queue';
const STORE = 'requests';
const SYNC_TAG = 'offline-queue';
const GET_TIMEOUT_MS = 10000;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000; // same as the server's idempotency keys
const MAX_ATTEMPTS = 5; // server errors before giving up on one request

// Never cached / never queued.
const NOT_CACHED = [/^\/api\/me$/, /^\/api\/ping$/, /\/export/, /^\/api\/push\//];
const NOT_QUEUED = [/^\/api\/login$/, /^\/api\/logout$/, /^\/api\/push\//, /\/import$/, /\/imports?\//];

/* ---------------------------------------------------------------- IndexedDB */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('key', 'key', { unique: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    let result;
    Promise.resolve(fn(t.objectStore(STORE))).then((r) => (result = r));
    t.oncomplete = () => {
      db.close();
      resolve(result);
    };
    t.onerror = t.onabort = () => {
      db.close();
      reject(t.error);
    };
  });
}

const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Adds the request unless the same idempotency key is already queued. */
function enqueue(entry) {
  return tx('readwrite', async (store) => {
    const existing = await asPromise(store.index('key').getKey(entry.key));
    if (existing === undefined) store.add(entry);
  });
}
const queueCount = () => tx('readonly', (store) => asPromise(store.count()));
const firstEntry = () =>
  tx('readonly', (store) => new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  }));
const removeEntry = (id) => tx('readwrite', (store) => store.delete(id));
const saveEntry = (entry) => tx('readwrite', (store) => store.put(entry));

/* ------------------------------------------------------------------ helpers */

async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((c) => c.postMessage(message));
}

async function sessionHash(request) {
  const auth = request.headers.get('Authorization');
  if (!auth) return 'anon';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(auth));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function cacheKey(request) {
  const url = new URL(request.url);
  url.searchParams.set('__session', await sessionHash(request));
  return url.href;
}

async function tagged(response, extra) {
  const headers = new Headers(response.headers);
  Object.entries(extra).forEach(([k, v]) => headers.set(k, v));
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
}

function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve('timeout'), ms));
}

async function messageOf(response) {
  try {
    const data = await response.clone().json();
    if (data && data.errors) return Object.values(data.errors).flat().join(' ');
    if (data && data.message) return data.message;
  } catch {
    /* not JSON */
  }
  return `Erreur ${response.status}`;
}

/**
 * Did this answer really come from the Laravel API? A proxy's 502/503/504
 * (backend down) or a Wi-Fi login page answering 200 HTML are "no server",
 * exactly like no network: they must never be cached, shown as data, or
 * make a queued write look sent.
 */
function fromApi(response) {
  if ([502, 503, 504].includes(response.status)) return false;
  if (response.status === 204 || response.status === 304) return true;
  const type = response.headers.get('Content-Type') || '';
  return type.includes('json') || type.includes('spreadsheet') || type.includes('pdf') || type.includes('octet-stream') || type.startsWith('image/');
}

/* -------------------------------------------------------------------- reads */

const CACHE_MAX_ENTRIES = 400;
const CACHE_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
let putsSincePrune = 0;

async function pruneCache() {
  const cache = await caches.open(API_CACHE);
  const keys = await cache.keys();
  const now = Date.now();
  let kept = keys.length;
  for (const req of keys) {
    const res = await cache.match(req);
    const at = Date.parse((res && res.headers.get('X-Cached-At')) || '');
    if (!at || now - at > CACHE_MAX_AGE_MS || kept > CACHE_MAX_ENTRIES) {
      await cache.delete(req);
      kept -= 1;
    }
  }
}

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  const key = await cacheKey(request);

  const network = fetch(request).then(async (response) => {
    if (!fromApi(response)) throw new Error('server unreachable');
    if (response.ok) {
      try {
        await cache.put(key, await tagged(response.clone(), { 'X-Cached-At': new Date().toISOString() }));
        if (++putsSincePrune >= 50) {
          putsSincePrune = 0;
          pruneCache().catch(() => undefined);
        }
      } catch {
        /* storage full: the answer still goes through */
      }
    }
    flushSoon();
    return response;
  });
  network.catch(() => undefined); // answered from the cache: not an unhandled rejection

  try {
    const first = await Promise.race([network, timeout(GET_TIMEOUT_MS)]);
    if (first !== 'timeout') return first;
    // Slow network: show the saved copy if there is one, else keep waiting.
    const hit = await cache.match(key);
    return hit ? tagged(hit, { 'X-From-Cache': '1' }) : network;
  } catch {
    const hit = await cache.match(key);
    if (hit) return tagged(hit, { 'X-From-Cache': '1' });
    return Response.error(); // the page sees "no network", never an HTML error page as data
  }
}

/* ------------------------------------------------------------------- writes */

async function sendOrQueue(request, path) {
  const key = request.headers.get('X-Idempotency-Key');
  const queueable = key && !NOT_QUEUED.some((re) => re.test(path));
  // The body must be read before fetch() consumes the request.
  const body = queueable && request.method !== 'DELETE' ? await request.clone().arrayBuffer() : null;

  try {
    const response = await fetch(request);
    // Backend down behind the proxy / Wi-Fi login page: not received.
    // (A 504 may have been processed: the idempotency key makes the replay safe.)
    if (!fromApi(response)) throw new Error('server unreachable');
    flushSoon();
    return response;
  } catch (err) {
    if (!queueable) return Response.error();

    await enqueue({
      key,
      url: request.url,
      method: request.method,
      headers: [...request.headers.entries()],
      body,
      createdAt: Date.now(),
      attempts: 0,
    });
    try {
      await self.registration.sync.register(SYNC_TAG);
    } catch {
      /* no Background Sync (iOS, Firefox): the page asks for a flush instead */
    }
    broadcast({ type: 'offline-queue', count: await queueCount() });

    return new Response(
      JSON.stringify({ queued: true, message: 'Enregistré sur l’appareil : envoi automatique au retour du réseau.' }),
      { status: 202, headers: { 'Content-Type': 'application/json', 'X-Offline-Queued': '1' } },
    );
  }
}

/* ------------------------------------------------------------------- replay */

let flushing = null;
let flushTimer = null;

function flush() {
  if (!flushing) flushing = replayAll().finally(() => (flushing = null));
  return flushing;
}

// After any API answer from the network (cheap when the queue is empty).
function flushSoon() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 500);
}

async function replayAll() {
  let sent = 0;
  const failed = [];

  for (;;) {
    let entry;
    try {
      entry = await firstEntry();
    } catch {
      break;
    }
    if (!entry) break;

    if (Date.now() - entry.createdAt > MAX_AGE_MS) {
      await removeEntry(entry.id);
      failed.push({ method: entry.method, url: entry.url, message: 'Action hors connexion trop ancienne (plus de 7 jours), non envoyée.' });
      continue;
    }

    let response;
    try {
      response = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body,
        credentials: 'same-origin',
      });
    } catch {
      break; // still no network: keep it (and everything after it) for later
    }
    if (!fromApi(response)) break; // server still unreachable behind the proxy

    const retryLater = response.status >= 500 || response.status === 429 || response.status === 409 && response.headers.has('Retry-After');
    if (retryLater) {
      entry.attempts += 1;
      if (entry.attempts < MAX_ATTEMPTS) {
        await saveEntry(entry);
        break; // keep the order: try again on the next flush
      }
    }

    await removeEntry(entry.id);
    if (response.ok) sent += 1;
    else failed.push({ method: entry.method, url: entry.url, status: response.status, message: await messageOf(response) });
  }

  let remaining = 0;
  try {
    remaining = await queueCount();
  } catch {
    /* ignore */
  }
  if (sent || failed.length) broadcast({ type: 'offline-sync', sent, failed, remaining });
  else broadcast({ type: 'offline-queue', count: remaining });
}

/* ------------------------------------------------------------------- events */

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/')) return;

  if (event.request.method === 'GET') {
    if (NOT_CACHED.some((re) => re.test(url.pathname))) return; // straight to the network
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(sendOrQueue(event.request, url.pathname));
});

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(flush());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'flush-offline-queue') event.waitUntil(flush());
  // Logout: this account's saved data leaves the device.
  if (type === 'clear-api-cache') event.waitUntil(caches.delete(API_CACHE));
  if (type === 'offline-queue-status') {
    event.waitUntil(queueCount().then((count) => event.source && event.source.postMessage({ type: 'offline-queue', count })));
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Previous versions: Workbox's own API cache (shared by every account)
      // and its background-sync queue, whose requests had no idempotency key
      // and were replayed many times — dropped rather than re-sent once more.
      await caches.delete('api-get-cache');
      try {
        indexedDB.deleteDatabase('workbox-background-sync');
      } catch {
        /* ignore */
      }
      await flush();
    })(),
  );
});
