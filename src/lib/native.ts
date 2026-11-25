import { useEffect, useRef } from 'react';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Native helpers in the Android app (android/app/src/main/java/com/readx/app/ReaderPlugin.java). */
interface ReaderNativePlugin {
  setKeepAwake(o: { on: boolean }): Promise<void>;
  setVolumeKeys(o: { on: boolean }): Promise<void>;
  saveFile(o: { name: string; content: string; mime: string }): Promise<{ path: string }>;
  shareFile(o: { name: string; content: string; mime: string; title: string }): Promise<void>;
  addListener(event: 'volumeKey', cb: (d: { key: 'up' | 'down' }) => void): Promise<PluginListenerHandle>;
}

export const ReaderNative = registerPlugin<ReaderNativePlugin>('ReaderNative');
export const isNative = Capacitor.isNativePlatform();

/** Keep the screen on while `on` (Android: window flag; web: Screen Wake Lock, where supported). */
export function useKeepAwake(on: boolean) {
  useEffect(() => {
    if (!on) return;
    if (isNative) {
      ReaderNative.setKeepAwake({ on: true }).catch(() => {});
      return () => void ReaderNative.setKeepAwake({ on: false }).catch(() => {});
    }
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!wl) return;
    let sentinel: { release(): Promise<void> } | null = null;
    let stopped = false;
    // The browser drops the lock whenever the tab is hidden: take it again on return
    const acquire = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      wl.request('screen')
        .then((s) => {
          if (stopped) void s.release();
          else sentinel = s;
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      sentinel?.release().catch(() => {});
    };
  }, [on]);
}

/** Android: volume down = next page, volume up = previous, while `on`. */
export function useVolumeKeys(on: boolean, onKey: (key: 'up' | 'down') => void) {
  const cb = useRef(onKey);
  cb.current = onKey;
  useEffect(() => {
    if (!isNative || !on) return;
    ReaderNative.setVolumeKeys({ on: true }).catch(() => {});
    const sub = ReaderNative.addListener('volumeKey', ({ key }) => cb.current(key));
    return () => {
      ReaderNative.setVolumeKeys({ on: false }).catch(() => {});
      sub.then((s) => s.remove()).catch(() => {});
    };
  }, [on]);
}
