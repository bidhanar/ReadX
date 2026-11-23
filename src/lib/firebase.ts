import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  browserPopupRedirectResolver,
  connectAuthEmulator,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Local development against the Firebase emulators (`npm run dev:emu`). Book files then live in the browser's Cache API. */
export const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
if (useEmulators) {
  config.apiKey ||= 'demo-key';
  config.projectId ||= 'demo-readx';
  config.authDomain ||= 'demo-readx.firebaseapp.com';
  config.appId ||= 'demo-app';
}

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

export const app = initializeApp(config);

// In the Android WebView the popup resolver is useless (native sign-in is used instead) and
// IndexedDB persistence is the most reliable.
export const auth = Capacitor.isNativePlatform()
  ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
  : initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });

export const db = initializeFirestore(app, {
  // Keep groups, chat, notes, progress and not-yet-synced changes on the device, so the app works
  // offline and queued changes survive reloads/restarts (default size is 40 MB)
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: 200 * 1024 * 1024 }),
});

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
