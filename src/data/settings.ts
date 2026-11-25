import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../lib/types';
import { queued } from './sync';
import { useLiveDoc } from './useLive';

const settingsRef = (uid: string) => doc(db, 'users', uid, 'settings', 'app');

/** Reader behaviour that follows you across devices (spoiler shield, keep screen on, volume keys). */
export function useAppSettings(uid: string) {
  const live = useLiveDoc<Partial<AppSettings>>(settingsRef(uid), `settings:${uid}`);
  const settings = useMemo<AppSettings>(() => ({ ...DEFAULT_APP_SETTINGS, ...live.data }), [live.data]);
  const update = useCallback(
    (patch: Partial<AppSettings>) => queued(setDoc(settingsRef(uid), patch, { merge: true }), 'Save settings'),
    [uid],
  );
  return { settings, update, loading: live.loading };
}

/**
 * A setting kept on this device only (e.g. night light: a phone at night and a laptop by day want
 * different values). Storage can be unavailable (private mode), so failures just fall back.
 */
export function useDeviceSetting<T extends object>(key: string, initial: T) {
  const storageKey = `readx:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* not persisted */
    }
  }, [storageKey, value]);
  return [value, setValue] as const;
}

export interface NightLight {
  /** 0 (off) .. 0.7: darkens the whole screen beyond the system's lowest brightness. */
  dim: number;
  /** 0 (off) .. 0.5: filters out blue light. */
  warmth: number;
}
export const useNightLight = () => useDeviceSetting<NightLight>('nightLight', { dim: 0, warmth: 0 });
