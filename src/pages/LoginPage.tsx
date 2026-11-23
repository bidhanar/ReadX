import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { IconGoogle } from '../components/icons';
import { ErrorText, FullScreenSpinner, Spinner } from '../components/ui';
import { publicUrl } from '../lib/util';

export default function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const from = (location.state as { from?: string } | null)?.from || '/';

  if (loading) return <FullScreenSpinner />;
  if (user) return <Navigate to={from} replace />;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="safe-top flex min-h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <img src={publicUrl('icon.svg')} alt="ReadX" className="mx-auto mb-4 h-32 w-32" />
        <h1 className="font-serif text-4xl font-semibold tracking-tight">ReadX</h1>
        <p className="text-ink-soft mt-3 mb-10">
          Read books together. Highlight, annotate and talk about every page with your group, whenever you get to it.
        </p>
        <button className="btn-outline w-full py-3 text-base" onClick={go} disabled={busy}>
          {busy ? <Spinner /> : <IconGoogle />}
          Continue with Google
        </button>
        <ErrorText error={error} />
      </div>
    </div>
  );
}
