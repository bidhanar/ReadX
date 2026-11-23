import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Offline-first writes.
 *
 * Firestore applies every write to its local cache immediately (the UI updates at once, online
 * or not) and syncs it to the server when a connection is available. The promise a write returns
 * only settles when the *server* confirms, which never happens while offline, so the app must not
 * wait on it. `queued()` records the write as pending, never blocks the caller, and reports the
 * rare server rejection (e.g. you were removed from the group while offline).
 */

interface SyncState {
  pending: number;
  error: { what: string; message: string } | null;
}

let state: SyncState = { pending: 0, error: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  emit();
};

export function queued(write: Promise<unknown>, what: string): void {
  set({ pending: state.pending + 1 });
  write
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[sync] ${what} failed`, e);
      set({ error: { what, message } });
    })
    .finally(() => set({ pending: Math.max(0, state.pending - 1) }));
}

export const dismissSyncError = () => set({ error: null });

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Browser/WebView connectivity (navigator.onLine + online/offline events). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

/** Thrown by actions that genuinely need the server (uploading a book, joining by code). */
export class NeedsInternetError extends Error {
  constructor(action: string) {
    super(`You're offline. ${action} needs an internet connection.`);
  }
}
