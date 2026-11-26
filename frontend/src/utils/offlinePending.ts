import { useSyncExternalStore } from 'react';

/**
 * What the pompiste saved WITHOUT network and is still waiting in the service
 * worker's queue (public/offline-sw.js), kept on the device so that:
 * - the day's list shows it at once ("En attente d'envoi") instead of looking
 *   lost — otherwise the bon gets typed a second time;
 * - the next bon starts from the right série / n° (the citerne's numbers on
 *   screen are a saved copy from before the network was lost);
 * - a bon the server refused when it was finally sent (same n°…) stays
 *   visible with the reason, so it can be typed again correctly.
 * Each line is keyed by the request's X-Idempotency-Key, which the service
 * worker reports back ('offline-sent') once it has been sent.
 */
export type PendingKind = 'bon' | 'livraison';

export interface PendingItem {
  key: string;
  kind: PendingKind;
  user_id: number | null;
  tank_id: number;
  created_at: number;
  date: string;
  time: string | null;
  quantity: number | null;
  /** Bon: n° du bon, véhicule, conducteur, séries. Livraison: fournisseur, BL. */
  bon_number?: string | null;
  vehicle_code?: string | null;
  driver_name?: string | null;
  serie_start?: number | null;
  serie_end?: number | null;
  supplier?: string | null;
  bl_number?: string | null;
  /** Set when the server refused it on replay. */
  error?: string | null;
}

const LS_KEY = 'offline-pending-v1';
const MAX_AGE_MS = 8 * 24 * 3600 * 1000;
const EVENT = 'offline-pending-changed';

let cache: PendingItem[] | null = null;

function load(): PendingItem[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    cache = Array.isArray(raw) ? raw.filter((i) => i && Date.now() - i.created_at < MAX_AGE_MS) : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function save(items: PendingItem[]) {
  cache = items;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch {
    /* storage full / private mode: the in-memory copy still works for this session */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function addPending(item: PendingItem) {
  save([...load().filter((i) => i.key !== item.key), item]);
}

export function removePending(key: string) {
  const items = load();
  if (items.some((i) => i.key === key)) save(items.filter((i) => i.key !== key));
}

function markFailed(key: string, message: string) {
  save(load().map((i) => (i.key === key ? { ...i, error: message } : i)));
}

export function usePending(kind: PendingKind, tankId: number | null | undefined, userId: number | null | undefined): PendingItem[] {
  const all = useSyncExternalStore(subscribe, load, load);
  return all.filter((i) => i.kind === kind && i.tank_id === tankId && (i.user_id == null || i.user_id === userId));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

/** A fresh key for one write; the same value goes into the X-Idempotency-Key header. */
export function newRequestKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The n° after the LAST pending bon (in the order they were typed), padded like
 * it: "0075951" → "0075952". It follows what the pompiste typed (user's rule,
 * 2026-11-26): pre-filled 75976, he types 79150 → next 79151, 79152… exactly
 * like the server's next_bon. No numeric pending bon → the server's suggestion.
 */
export function nextNumber(current: string | null | undefined, pendingInOrder: (string | null | undefined)[]): string | null {
  for (let i = pendingInOrder.length - 1; i >= 0; i--) {
    const t = (pendingInOrder[i] ?? '').trim();
    if (/^\d{1,15}$/.test(t)) return String(Number(t) + 1).padStart(t.length, '0');
  }
  return current ?? null;
}

let started = false;

/** Listens to the service worker's results; call once at start-up. */
export function startOfflinePendingSync(onChange?: () => void) {
  if (started || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  started = true;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as { type?: string; key?: string; ok?: boolean; message?: string | null; keys?: string[] | null } | null;
    if (!data?.type) return;
    if (data.type === 'offline-sent' && data.key) {
      if (data.ok) removePending(data.key);
      else markFailed(data.key, data.message || "Refusé par le serveur");
      onChange?.();
    }
    if (data.type === 'offline-queue-keys' && Array.isArray(data.keys)) {
      // Sent while the app was closed: no longer in the queue → no longer pending
      // (lines that failed keep their error until the pompiste removes them).
      const queued = new Set(data.keys);
      const before = load();
      const after = before.filter((i) => i.error || queued.has(i.key) || Date.now() - i.created_at < 5000);
      if (after.length !== before.length) {
        save(after);
        onChange?.();
      }
    }
    if (data.type === 'offline-sync' || data.type === 'offline-queue') reconcile();
  });
  reconcile();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reconcile());
}

function reconcile() {
  if (!load().length) return;
  navigator.serviceWorker?.controller?.postMessage({ type: 'offline-queue-keys' });
}
