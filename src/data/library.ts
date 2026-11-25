import { useEffect, useMemo, useState } from 'react';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Query,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Book, Bookmark, Group, LibraryEntry, Progress, Shelf } from '../lib/types';
import { isOnline, queued } from './sync';
import { listenWithRetry, useLiveQuery } from './useLive';

/**
 * Your personal library, private under users/{uid}:
 *  - library/{gid}__{bookId}: where you are in each book, how far you've read, your shelves for it
 *  - library/{key}/bookmarks/{id}
 *  - shelves/{id}: shelves you made
 * The group's progress doc (visible to members) is still the source for "who's where"; the
 * library copy lets Home list every book you read across groups with one query.
 */

export const libKey = (gid: string, bookId: string) => `${gid}__${bookId}`;
const libCol = (uid: string) => collection(db, 'users', uid, 'library');
const libRef = (uid: string, gid: string, bookId: string) => doc(libCol(uid), libKey(gid, bookId));
const shelvesCol = (uid: string) => collection(db, 'users', uid, 'shelves');
const bookmarksCol = (uid: string, gid: string, bookId: string) => collection(libRef(uid, gid, bookId), 'bookmarks');

/** Counts as finished at the very end, unless you said otherwise. */
export const isFinished = (e: LibraryEntry | undefined) => e?.finished ?? (e?.percent ?? 0) >= 0.995;
export const isStarted = (e: LibraryEntry | undefined) => !!e && (e.percent ?? 0) > 0;

// ---- Entries --------------------------------------------------------------------------------------

export function useLibrary(uid: string) {
  return useLiveQuery<LibraryEntry>(libCol(uid), `lib:${uid}`);
}

export function useLibraryEntry(uid: string, gid: string, bookId: string) {
  const all = useLibrary(uid);
  return { ...all, data: all.data.find((e) => e.id === libKey(gid, bookId)) ?? null };
}

export const saveLibraryPosition = (uid: string, gid: string, bookId: string, location: string, percent: number, furthest?: string) =>
  queued(
    setDoc(
      libRef(uid, gid, bookId),
      { gid, bookId, location, percent, readAt: serverTimestamp(), ...(furthest ? { furthest } : {}) },
      { merge: true },
    ),
    'Save reading position',
  );

export const setFinished = (uid: string, gid: string, bookId: string, finished: boolean) =>
  queued(setDoc(libRef(uid, gid, bookId), { gid, bookId, finished }, { merge: true }), 'Mark as finished');

export const setOnShelf = (uid: string, gid: string, bookId: string, shelfId: string, on: boolean) =>
  queued(
    setDoc(libRef(uid, gid, bookId), { gid, bookId, shelves: on ? arrayUnion(shelfId) : arrayRemove(shelfId) }, { merge: true }),
    'Update shelf',
  );

// ---- Shelves --------------------------------------------------------------------------------------

export function useShelves(uid: string) {
  return useLiveQuery<Shelf>(query(shelvesCol(uid), orderBy('createdAt')), `shelves:${uid}`);
}

/** Returns the new shelf's id at once (works offline). */
export function createShelf(uid: string, name: string): string {
  const ref = doc(shelvesCol(uid));
  queued(setDoc(ref, { name: name.trim().slice(0, 60), createdAt: serverTimestamp() }), 'Create shelf');
  return ref.id;
}

export const renameShelf = (uid: string, id: string, name: string) =>
  queued(updateDoc(doc(shelvesCol(uid), id), { name: name.trim().slice(0, 60) }), 'Rename shelf');

/** Delete a shelf and take it off every book (the books themselves stay). */
export function deleteShelf(uid: string, id: string, entries: LibraryEntry[]) {
  const batch = writeBatch(db);
  batch.delete(doc(shelvesCol(uid), id));
  for (const e of entries) if (e.shelves?.includes(id)) batch.update(doc(libCol(uid), e.id), { shelves: arrayRemove(id) });
  queued(batch.commit(), 'Delete shelf');
}

// ---- Bookmarks ------------------------------------------------------------------------------------

export function useBookmarks(uid: string, gid: string, bookId: string) {
  return useLiveQuery<Bookmark>(bookmarksCol(uid, gid, bookId), `bm:${uid}/${gid}/${bookId}`);
}

export function addBookmark(uid: string, gid: string, bookId: string, b: Omit<Bookmark, 'id' | 'createdAt'>) {
  // The parent entry must exist for Home to know about the book
  queued(setDoc(libRef(uid, gid, bookId), { gid, bookId }, { merge: true }), 'Save bookmark');
  queued(setDoc(doc(bookmarksCol(uid, gid, bookId)), { ...b, createdAt: serverTimestamp() }), 'Save bookmark');
}

export const deleteBookmark = (uid: string, gid: string, bookId: string, id: string) =>
  queued(deleteDoc(doc(bookmarksCol(uid, gid, bookId), id)), 'Remove bookmark');

// ---- Many live queries at once ----------------------------------------------------------------------

/** One live listener per spec; results by key. `depKey` must change when the specs change. */
function useQueries<T>(specs: { key: string; q: Query<DocumentData> }[], depKey: string) {
  const [state, setState] = useState<{ data: Map<string, (T & { id: string })[]>; loading: boolean }>({
    data: new Map(),
    loading: specs.length > 0,
  });
  useEffect(() => {
    const data = new Map<string, (T & { id: string })[]>();
    const pending = new Set(specs.map((s) => s.key));
    const emit = () => setState({ data: new Map(data), loading: pending.size > 0 });
    const unsubs = specs.map((s) =>
      listenWithRetry(
        (onError) =>
          onSnapshot(
            s.q,
            (snap) => {
              data.set(
                s.key,
                snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as T & { id: string }),
              );
              pending.delete(s.key);
              emit();
            },
            onError,
          ),
        () => {
          pending.delete(s.key);
          emit();
        },
      ),
    );
    if (specs.length === 0) emit();
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);
  return state;
}

export interface LibraryBook {
  gid: string;
  groupName: string;
  book: Book;
}

/** Every book on the shelves of all your groups, newest first. */
export function useAllBooks(groups: Group[]) {
  const specs = useMemo(
    () => groups.map((g) => ({ key: g.id, q: query(collection(db, 'groups', g.id, 'books'), orderBy('createdAt', 'desc')) })),
    [groups],
  );
  const { data, loading } = useQueries<Book>(specs, groups.map((g) => g.id).join(','));
  const books = useMemo(() => {
    const out: LibraryBook[] = [];
    for (const g of groups) for (const book of data.get(g.id) ?? []) out.push({ gid: g.id, groupName: g.name, book });
    return out.sort((a, b) => (b.book.createdAt?.toMillis() ?? 0) - (a.book.createdAt?.toMillis() ?? 0));
  }, [groups, data]);
  return { books, loading };
}

/** Everyone's reading position for each book of a group: bookId → progress list. */
export function useGroupProgress(gid: string, bookIds: string[]) {
  const specs = useMemo(
    () => bookIds.map((id) => ({ key: id, q: query(collection(db, 'groups', gid, 'books', id, 'progress')) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gid, bookIds.join(',')],
  );
  return useQueries<Progress>(specs, `${gid}:${bookIds.join(',')}`).data;
}

/**
 * Positions saved before the library existed live only in the group progress docs. Copy them in
 * once per book so Home's "Continue reading" and the spoiler shield know about them.
 */
const backfilled = new Set<string>();
export function useLibraryBackfill(uid: string, books: LibraryBook[], entries: LibraryEntry[], ready: boolean) {
  useEffect(() => {
    if (!ready || !isOnline()) return;
    const have = new Set(entries.map((e) => e.id));
    for (const { gid, book } of books) {
      const key = libKey(gid, book.id);
      if (have.has(key) || backfilled.has(key)) continue;
      backfilled.add(key);
      getDoc(doc(db, 'groups', gid, 'books', book.id, 'progress', uid))
        .then((snap) => {
          const p = snap.exists() ? (snap.data() as Progress) : null;
          return setDoc(
            libRef(uid, gid, book.id),
            p
              ? { gid, bookId: book.id, location: p.location, percent: p.percent, furthest: p.location, readAt: p.updatedAt ?? serverTimestamp() }
              : { gid, bookId: book.id },
            { merge: true },
          );
        })
        .catch(() => backfilled.delete(key));
    }
  }, [uid, books, entries, ready]);
}
