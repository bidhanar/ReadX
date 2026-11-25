import { useSyncExternalStore } from 'react';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

/**
 * App-wide light / dark mode. The choice is kept on this device ('system' until you pick one);
 * index.html applies it before the first paint so pages never flash the wrong colours.
 * Dark mode uses the bidhanar.github.io "Rotor Verse" palette (see the dark tokens in index.css).
 */
export type ThemeMode = 'system' | 'light' | 'dark';
export type Resolved = 'light' | 'dark';

const KEY = 'readx:appTheme';
const BAR = { light: '#faf7f1', dark: '#0c0d12' } as const;
const mq = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let mode: ThemeMode = read();
const resolve = (): Resolved => (mode === 'system' ? (mq?.matches ? 'dark' : 'light') : mode);
let state = { mode, resolved: resolve() };
const listeners = new Set<() => void>();

function apply() {
  state = { mode, resolved: resolve() };
  const root = document.documentElement;
  root.dataset.theme = state.resolved;
  root.style.colorScheme = state.resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[state.resolved]);
  // Android: light icons on the dark status/navigation bars, dark icons on light ones
  if (Capacitor.isNativePlatform())
    SystemBars.setStyle({ style: state.resolved === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  listeners.forEach((l) => l());
}

mq?.addEventListener('change', () => mode === 'system' && apply());
apply();

export function setThemeMode(next: ThemeMode) {
  mode = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* kept for this session only */
  }
  apply();
}

/** Flip between light and dark (leaving "follow the device" behind). */
export const toggleTheme = () => setThemeMode(state.resolved === 'dark' ? 'light' : 'dark');

export function useAppTheme() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
