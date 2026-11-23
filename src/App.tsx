import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { useAuth } from './auth/AuthProvider';
import { firebaseConfigured } from './lib/firebase';
import { supabaseConfigured } from './lib/supabase';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import GroupPage from './pages/GroupPage';
import JoinPage from './pages/JoinPage';
import { FullScreenSpinner } from './components/ui';
import { SyncStatus } from './components/SyncStatus';

const ReaderPage = lazy(() => import('./pages/ReaderPage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  return <>{children}</>;
}

/** Android: open https://<site>/join/CODE links inside the app, and make the hardware back button navigate. */
function NativeBridges() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const subs = [
      CapApp.addListener('appUrlOpen', ({ url }) => {
        // Links may be https://site/join/CODE or https://site/readx/#/join/CODE (GitHub Pages)
        const u = new URL(url);
        const route = u.hash.startsWith('#/') ? u.hash.slice(1) : u.pathname.replace(/^\/readx/, '') + u.search;
        if (route.startsWith('/join/') || route.startsWith('/g/')) navigate(route);
      }),
      CapApp.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) window.history.back();
        else CapApp.exitApp();
      }),
    ];
    return () => subs.forEach((p) => p.then((s) => s.remove()));
  }, [navigate]);
  return null;
}

function SetupNotice() {
  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="mb-2 text-xl font-semibold">ReadX isn't configured yet</h1>
      <p className="text-ink-soft text-sm">
        Copy <code>.env.example</code> to <code>.env.local</code>, fill in your Firebase
        {supabaseConfigured ? '' : ' and Supabase'} keys, then restart <code>npm run dev</code>. See README.md →
        Setup.
      </p>
    </div>
  );
}

export default function App() {
  if (!firebaseConfigured) return <SetupNotice />;
  return (
    <>
      <NativeBridges />
      <SyncStatus />
      <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
          <Route path="/join/:code" element={<RequireAuth><JoinPage /></RequireAuth>} />
          <Route path="/g/:gid" element={<RequireAuth><GroupPage /></RequireAuth>} />
          <Route path="/g/:gid/chat" element={<RequireAuth><GroupPage tab="chat" /></RequireAuth>} />
          <Route path="/g/:gid/members" element={<RequireAuth><GroupPage tab="members" /></RequireAuth>} />
          <Route path="/g/:gid/b/:bookId" element={<RequireAuth><ReaderPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
