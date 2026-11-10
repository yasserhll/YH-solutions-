/*
 * Device notifications (Web Push), imported into the Workbox service worker
 * (vite.config.ts -> workbox.importScripts). Shows the notification sent by
 * the backend (App\Services\WebPushService) even when the app is closed,
 * tells any open window to refresh its bell at once, opens / focuses the app
 * on the right page when clicked, and re-registers the device by itself when
 * the browser renews its subscription.
 */
const PUSH_META = 'push-meta';
const ENDPOINT_KEY = '/__push-endpoint';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Solution Administrative';
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || '',
        icon: data.icon || '/icons/pwa-192x192.png',
        badge: data.badge || '/icons/pwa-64x64.png',
        tag: data.tag || 'app',
        renotify: true,
        requireInteraction: false,
        lang: 'fr',
        timestamp: Date.now(),
        data: { url: data.url || '/' },
      }),
      // An open window updates its bell / lists immediately.
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => clients.forEach((c) => c.postMessage({ type: 'push-received', tag: data.tag || 'app' }))),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          return client.focus().then((c) => (c && 'navigate' in c ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function storedEndpoint() {
  try {
    const res = await (await caches.open(PUSH_META)).match(ENDPOINT_KEY);
    return res ? await res.text() : null;
  } catch {
    return null;
  }
}

// The browser replaced this device's subscription (expiry, key rotation):
// subscribe again and move the server's row to the new endpoint, so alerts
// keep arriving without anyone having to reopen the app.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const oldEndpoint = (event.oldSubscription && event.oldSubscription.endpoint) || (await storedEndpoint());
      if (!oldEndpoint) return;

      let sub = event.newSubscription;
      if (!sub) {
        const { public_key } = await (await fetch('/api/push/key', { headers: { Accept: 'application/json' } })).json();
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(public_key) });
      }
      const json = sub.toJSON();
      await fetch('/api/push/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ old_endpoint: oldEndpoint, endpoint: json.endpoint, keys: json.keys }),
      });
      try {
        await (await caches.open(PUSH_META)).put(ENDPOINT_KEY, new Response(json.endpoint));
      } catch {
        /* ignore */
      }
    })(),
  );
});
