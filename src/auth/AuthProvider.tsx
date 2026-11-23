import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth, useEmulators } from '../lib/firebase';

interface AuthState {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Emulator-only test hook: sign in as a fake Google user without the popup
  useEffect(() => {
    if (!useEmulators) return;
    (window as unknown as Record<string, unknown>).__readxSignIn = (email: string, name: string) =>
      signInWithCredential(
        auth,
        GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, name, email_verified: true })),
      );
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setLoading(false);
      }),
    [],
  );

  const signInWithGoogle = async () => {
    if (Capacitor.isNativePlatform()) {
      // Native account picker → ID token → Firebase JS SDK session
      const result = await FirebaseAuthentication.signInWithGoogle();
      const idToken = result.credential?.idToken;
      if (!idToken) throw new Error('Google sign-in returned no ID token');
      await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    } else {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    }
  };

  const signOut = async () => {
    if (Capacitor.isNativePlatform()) await FirebaseAuthentication.signOut().catch(() => {});
    await fbSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** For components rendered only behind <RequireAuth>. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useUser without a signed-in user');
  return user;
}
