import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { useHashRouter } from './lib/util';

// GitHub Pages can't send every path to index.html, so that build routes with #/path instead
const Router = useHashRouter ? HashRouter : BrowserRouter;
import './index.css';
import './lib/theme';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { Capacitor } from '@capacitor/core';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router basename={useHashRouter ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Router>
  </StrictMode>,
);

// Website only: keep the app's files so it opens offline. (The Android app bundles them already;
// dev mode would cache stale modules.)
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('service worker', e));
  });
}
