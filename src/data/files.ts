import { useCallback, useEffect, useState } from 'react';
import { supabase, BOOKS_BUCKET, supabaseConfigured } from '../lib/supabase';
import { useEmulators } from '../lib/firebase';
import { NeedsInternetError, isOnline } from './sync';

/**
 * Book files live in Supabase Storage and are kept on the device in the Cache API (works on the
 * web and in the Android WebView). A book on the device opens instantly and offline.
 */
const CACHE = 'readx-books-v1';
const NO_STORAGE = 'Book storage is not set up yet: add the Supabase keys to .env.local (README → Setup → Supabase).';
const cacheKey = (path: string) => `/__readx_book__/${path}`;

const openCache = () => ('caches' in window ? caches.open(CACHE).catch(() => null) : Promise.resolve(null));

/** Ask the browser not to evict downloaded books under storage pressure (best effort, asked once). */
let askedPersist = false;
function askPersistentStorage() {
  if (askedPersist) return;
  askedPersist = true;
  navigator.storage?.persist?.().catch(() => {});
}

async function putInCache(path: string, body: Blob | ArrayBuffer, contentType: string) {
  const cache = await openCache();
  await cache?.put(cacheKey(path), new Response(body, { headers: { 'Content-Type': contentType } })).catch(() => {});
  askPersistentStorage();
  notify(path);
}

/** Open a book: from the device if downloaded, otherwise download (and keep) it. */
export async function loadBookFile(path: string, onProgress?: (msg: string) => void): Promise<ArrayBuffer> {
  const hit = await (await openCache())?.match(cacheKey(path));
  if (hit) return hit.arrayBuffer();

  if (useEmulators) throw new Error('Emulator mode: this book was uploaded from another browser, so its file is not here.');
  if (!supabaseConfigured) throw new Error(NO_STORAGE);
  if (!isOnline())
    throw new Error("This book isn't downloaded on this device yet. Connect to the internet once to open it; after that it works offline.");
  onProgress?.('Downloading book…');
  const { data, error } = await supabase.storage.from(BOOKS_BUCKET).download(path);
  if (error || !data) throw new Error(`Could not download the book: ${error?.message ?? 'unknown error'}`);
  const buf = await data.arrayBuffer();
  await putInCache(path, buf.slice(0), data.type || 'application/octet-stream');
  return buf;
}

export async function isBookCached(path: string): Promise<boolean> {
  return !!(await (await openCache())?.match(cacheKey(path)));
}

export async function uploadBookFile(path: string, file: Blob, contentType: string, uploadedBy: string) {
  if (useEmulators) return putInCache(path, file, contentType);
  if (!supabaseConfigured) throw new Error(NO_STORAGE);
  if (!isOnline()) throw new NeedsInternetError('Adding a book');
  const { error } = await supabase.storage.from(BOOKS_BUCKET).upload(path, file, {
    contentType,
    upsert: false,
    metadata: { uploadedBy },
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  // Keep the uploader's copy so their new book also works offline
  await putInCache(path, file, contentType);
}

export async function deleteBookFile(path: string) {
  if (!useEmulators) await supabase.storage.from(BOOKS_BUCKET).remove([path]);
  await removeFromDevice(path);
}

export async function removeFromDevice(path: string) {
  await (await openCache())?.delete(cacheKey(path));
  notify(path);
}

// ---- "On this device" state for the shelf --------------------------------------------------------

const listeners = new Set<(path: string) => void>();
const notify = (path: string) => listeners.forEach((l) => l(path));

/** Which of these book files are on this device; updates as books are downloaded or removed. */
export function useOnDevice(paths: string[]) {
  const [onDevice, setOnDevice] = useState<Set<string>>(new Set());
  const key = paths.join('|');
  const refresh = useCallback(async () => {
    const cache = await openCache();
    const hits = await Promise.all(paths.map(async (p) => ((await cache?.match(cacheKey(p))) ? p : null)));
    setOnDevice(new Set(hits.filter((p): p is string => !!p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    refresh();
    const l = (p: string) => paths.includes(p) && refresh();
    listeners.add(l);
    return () => void listeners.delete(l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);
  return onDevice;
}

/** Download books for offline reading, one at a time. */
export async function downloadBooks(paths: string[], onEach?: (done: number, total: number) => void) {
  let done = 0;
  for (const p of paths) {
    await loadBookFile(p);
    onEach?.(++done, paths.length);
  }
}
