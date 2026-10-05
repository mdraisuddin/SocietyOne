import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, api } from './api';

/**
 * Offline queue for the Security App. Gate actions (check-in/out, deliveries) made while the
 * network is down are stored locally with an idempotency key and replayed in order when the
 * connection returns. The server de-duplicates using the key, so retries are always safe.
 */
export interface QueuedAction {
  id: string;
  path: string;
  body: unknown;
  label: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

const KEY = 'so_guard_queue_v1';
let listeners: (() => void)[] = [];
const emit = () => listeners.forEach((l) => l());

function read(): QueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}
function write(q: QueuedAction[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable */
  }
  cached = q;
  emit();
}
let cached = read();

export const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '');

export function useQueue() {
  return useSyncExternalStore(
    (l) => {
      listeners.push(l);
      return () => (listeners = listeners.filter((x) => x !== l));
    },
    () => cached,
  );
}

/** Try the request now; if the network is down, queue it. Returns 'sent' | 'queued'. */
export async function sendOrQueue(path: string, body: unknown, label: string): Promise<{ status: 'sent'; data: any } | { status: 'queued' }> {
  const id = newKey();
  try {
    const data = await api(path, { method: 'POST', body, headers: { 'Idempotency-Key': id } });
    return { status: 'sent', data };
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      write([...read(), { id, path, body, label, createdAt: Date.now(), attempts: 0 }]);
      return { status: 'queued' };
    }
    throw e;
  }
}

let flushing = false;
export async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const item of read().filter((x) => !x.lastError)) {
      try {
        await api(item.path, { method: 'POST', body: item.body, headers: { 'Idempotency-Key': item.id } });
        write(read().filter((x) => x.id !== item.id));
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // still offline — retry later
        // Rejected by the server (e.g. pass no longer valid): keep it visible for the guard, don't retry.
        write(read().map((x) => (x.id === item.id ? { ...x, attempts: x.attempts + 1, lastError: (e as Error).message } : x)));
      }
    }
  } finally {
    flushing = false;
  }
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => {
      setOnline(true);
      flushQueue();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const t = setInterval(flushQueue, 20_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(t);
    };
  }, []);
  return online;
}

/** Simple local cache for read data needed offline (e.g. today's expected visitors). */
export function dismissQueued(id: string) {
  write(read().filter((x) => x.id !== id));
}

export function cacheSet(key: string, value: unknown) {
  try {
    localStorage.setItem(`so_cache_${key}`, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* ignore */
  }
}
export function cacheGet<T>(key: string): { at: number; value: T } | null {
  try {
    const v = localStorage.getItem(`so_cache_${key}`);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
export function cacheClear() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('so_cache_') || k === KEY).forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
