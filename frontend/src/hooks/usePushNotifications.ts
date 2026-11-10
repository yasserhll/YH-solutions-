import { useCallback, useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';

/**
 * "Notifications sur cet appareil" (Web Push). Subscribes this browser /
 * installed PWA with the backend's VAPID key and registers it on the account,
 * so contract alerts arrive as real device notifications, app closed or not.
 *
 * Platform notes surfaced to the user:
 * - iPhone / iPad: only inside the app added to the Home Screen (iOS 16.4+).
 * - Needs HTTPS (or localhost) and a service worker (PwaStatus registers it).
 */
export type PushStatus = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const supported = () =>
  typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** The service worker registration, without hanging forever if there is none. */
async function registration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Le service de l'application n'est pas prêt. Rechargez la page puis réessayez.")), timeoutMs),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

function payload(sub: PushSubscription) {
  const json = sub.toJSON();
  const encodings = (PushManager as unknown as { supportedContentEncodings?: string[] }).supportedContentEncodings;
  return {
    endpoint: json.endpoint,
    keys: json.keys,
    content_encoding: encodings?.includes('aes128gcm') || !encodings ? 'aes128gcm' : 'aesgcm',
  };
}

/**
 * The service worker reads this endpoint back when the browser renews the
 * subscription (`pushsubscriptionchange` in public/push-sw.js).
 */
async function rememberEndpoint(endpoint: string | null) {
  try {
    const cache = await caches.open('push-meta');
    if (endpoint) await cache.put('/__push-endpoint', new Response(endpoint));
    else await cache.delete('/__push-endpoint');
  } catch {
    /* Cache API unavailable: the device re-syncs on next app open instead */
  }
}

/**
 * On every app start: if this device has notifications on, make sure the
 * server still has it (and under the account now logged in).
 */
export async function syncPushSubscription() {
  if (!supported() || Notification.permission !== 'granted') return;
  const sub = await currentSubscription();
  if (!sub) return;
  await rememberEndpoint(sub.endpoint);
  await api.post('/push/subscriptions', payload(sub)).catch(() => undefined);
}

/** Turns device notifications off for this browser — used on logout. */
export async function disablePushOnThisDevice() {
  const sub = await currentSubscription();
  await rememberEndpoint(null);
  if (!sub) return;
  try {
    await api.delete('/push/subscriptions', { data: { endpoint: sub.endpoint } });
  } catch {
    /* the server forgets it anyway once the push service reports it gone */
  }
  await sub.unsubscribe().catch(() => undefined);
}

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>(() => {
    if (isIos() && !isStandalone()) return 'ios-install';
    if (!supported()) return 'unsupported';
    return Notification.permission === 'denied' ? 'denied' : 'off';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reflect the real state of this device (and keep the server in sync).
  useEffect(() => {
    if (status === 'unsupported' || status === 'ios-install') return;
    let cancelled = false;
    currentSubscription().then((sub) => {
      if (cancelled) return;
      if (sub && Notification.permission === 'granted') setStatus('on');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const reg = await registration();
      const { data } = await api.get<{ public_key: string }>('/push/key');
      let sub = await reg.pushManager.getSubscription();
      // A subscription made with another key (e.g. a reinstalled server) can't be reused.
      if (sub) await sub.unsubscribe().catch(() => undefined);
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.public_key) });
      await api.post('/push/subscriptions', payload(sub));
      await rememberEndpoint(sub.endpoint);
      setStatus('on');
      // Confirms on the device itself that everything works end to end.
      // (a short pause: a brand-new subscription takes a moment to be known
      // by the push service; the server also retries on its side).
      const endpoint = sub.endpoint;
      setTimeout(() => {
        api.post('/push/test', { endpoint }).catch((e) => setError(apiErrorMessage(e)));
      }, 1500);
    } catch (e) {
      setError(e instanceof Error && !('isAxiosError' in e) ? e.message : apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await disablePushOnThisDevice();
      setStatus('off');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, enable, disable };
}
