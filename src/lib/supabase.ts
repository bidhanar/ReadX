import { createClient } from '@supabase/supabase-js';
import { auth } from './firebase';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

/**
 * Supabase is used only for file storage. Every request carries the Firebase ID token
 * (Supabase "third-party auth"), which the storage RLS policies verify.
 */
export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  accessToken: async () => (auth.currentUser ? await auth.currentUser.getIdToken() : null),
});

export const BOOKS_BUCKET = 'books';
