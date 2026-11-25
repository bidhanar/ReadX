import type { Timestamp } from 'firebase/firestore';

export function randomCode(len = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function formatTime(ts?: Timestamp | null): string {
  if (!ts) return '';
  const d = ts.toDate();
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) +
        ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Stable color per user id, for avatars and layer chips. */
export function userColor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}

/**
 * Routes look like `#/g/abc`. GitHub Pages can't send every path to index.html, and invite links
 * made anywhere (web, Android, local dev) must match the hosted site, so this is the default.
 * Set VITE_HASH_ROUTER=false for hosts that rewrite paths (e.g. Firebase Hosting).
 */
export const useHashRouter = import.meta.env.VITE_HASH_ROUTER !== 'false';

/** Where the web app lives, e.g. https://bidhanar.github.io/readx (no trailing slash). */
export function siteUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  return (window.location.origin + import.meta.env.BASE_URL).replace(/\/$/, '');
}

/** Shareable absolute link to an in-app route, e.g. appLink('/join/ABC') (works with either router). */
export function appLink(path: string): string {
  return useHashRouter ? `${siteUrl()}/#${path}` : `${siteUrl()}${path}`;
}

/** URL of a file in /public that respects the deploy base path (e.g. /readx/). */
export const publicUrl = (file: string) => `${import.meta.env.BASE_URL}${file}`;

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  let pending: Parameters<T> | null = null;
  const run = () => {
    clearTimeout(t);
    if (!pending) return;
    const args = pending;
    pending = null;
    fn(...args);
  };
  const wrapped = (...args: Parameters<T>) => {
    pending = args;
    clearTimeout(t);
    t = setTimeout(run, ms);
  };
  /** Run the waiting call now (if any). */
  wrapped.flush = run;
  /** Drop the waiting call. */
  wrapped.cancel = () => {
    clearTimeout(t);
    pending = null;
  };
  return wrapped;
}
