import { doc, getDoc, getDocFromCache, setDoc } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../lib/firebase';
import { DEFAULT_PREFS, type BookPrefs } from '../lib/types';
import { debounce } from '../lib/util';
import { isOnline, queued } from './sync';

const prefsRef = (uid: string, bookId: string) => doc(db, 'users', uid, 'bookPrefs', bookId);

/** Per-user, per-book reader preferences (layers, theme, font size, flip mode). Synced across devices. */
export function useBookPrefs(uid: string, bookId: string) {
  const [prefs, setPrefs] = useState<BookPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const save = useRef(
    debounce((p: BookPrefs) => {
      queued(setDoc(prefsRef(uid, bookId), p), 'Save reader settings');
    }, 800),
  );

  // Don't drop a change made just before leaving the book
  useEffect(() => {
    const flush = save.current.flush;
    return flush;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const apply = (data: unknown) => !cancelled && setPrefs({ ...DEFAULT_PREFS, ...(data as Partial<BookPrefs>) });
    (async () => {
      // Device copy first: instant, and works offline (a plain getDoc can wait ~10s offline)
      const cached = await getDocFromCache(prefsRef(uid, bookId)).catch(() => null);
      if (cached?.exists()) apply(cached.data());
      if (cached?.exists() || !isOnline()) {
        if (!cancelled) setLoaded(true);
      }
      // Then the server copy (settings may have changed on another device)
      if (isOnline()) {
        const fresh = await getDoc(prefsRef(uid, bookId)).catch(() => null);
        if (fresh?.exists() && !fresh.metadata.fromCache) apply(fresh.data());
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, bookId]);

  const update = useCallback((patch: Partial<BookPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      save.current(next);
      return next;
    });
  }, []);

  return { prefs, loaded, update };
}
