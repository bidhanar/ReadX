import { useEffect, useState } from 'react';
import {
  onSnapshot,
  type DocumentReference,
  type Query,
  type DocumentData,
} from 'firebase/firestore';

export interface Live<T> {
  data: T;
  loading: boolean;
  error: Error | null;
  /** Data came only from this device's cache (e.g. offline): "missing" may just mean "not synced here". */
  fromCache: boolean;
}

/** Every item from a live hook carries `_pending: true` while its local change awaits the server. */
export type WithPending<T> = T & { _pending?: boolean };

/**
 * Listen with retries on `permission-denied`. Firestore ends a listener permanently on a permission
 * error, which happens legitimately in a short window: right after you create or join a group
 * (the page starts listening before the server has your membership) and after reconnecting from
 * offline (listeners come back before queued writes are applied). Retrying a few times with
 * backoff covers that window; a real denial still surfaces after the last attempt.
 */
export function listenWithRetry(subscribe: (onError: (e: Error) => void) => () => void, onFinalError: (e: Error) => void) {
  let unsub = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;
  const start = () => {
    unsub = subscribe((e) => {
      const code = (e as Error & { code?: string }).code;
      if (code === 'permission-denied' && attempt < 5 && !stopped) timer = setTimeout(start, 400 * 2 ** attempt++);
      else onFinalError(e);
    });
  };
  start();
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsub();
  };
}

/**
 * Realtime query → array of `{id, ...data, _pending}`. Works offline from the local cache.
 * Pass null to skip. `key` must change when the query changes.
 */
export function useLiveQuery<T extends { id?: string }>(q: Query<DocumentData> | null, key: string): Live<WithPending<T>[]> {
  const [state, setState] = useState<Live<WithPending<T>[]>>({ data: [], loading: !!q, error: null, fromCache: false });
  useEffect(() => {
    if (!q) {
      setState({ data: [], loading: false, error: null, fromCache: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return listenWithRetry(
      (onError) =>
        onSnapshot(
          q,
          { includeMetadataChanges: true }, // so `_pending` flips when the server confirms
          (snap) =>
            setState({
              data: snap.docs.map(
                (d) =>
                  ({
                    id: d.id,
                    ...d.data({ serverTimestamps: 'estimate' }),
                    _pending: d.metadata.hasPendingWrites,
                  }) as unknown as WithPending<T>,
              ),
              loading: false,
              error: null,
              fromCache: snap.metadata.fromCache,
            }),
          onError,
        ),
      (error) => setState({ data: [], loading: false, error, fromCache: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function useLiveDoc<T>(ref: DocumentReference<DocumentData> | null, key: string): Live<T | null> {
  const [state, setState] = useState<Live<T | null>>({ data: null, loading: !!ref, error: null, fromCache: false });
  useEffect(() => {
    if (!ref) {
      setState({ data: null, loading: false, error: null, fromCache: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return listenWithRetry(
      (onError) =>
        onSnapshot(
          ref,
          { includeMetadataChanges: true },
          (snap) =>
            setState({
              data: snap.exists() ? ({ id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) } as unknown as T) : null,
              loading: false,
              error: null,
              fromCache: snap.metadata.fromCache,
            }),
          onError,
        ),
      (error) => setState({ data: null, loading: false, error, fromCache: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
