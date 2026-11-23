import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Anchor, Annotation, AnnotationType, HighlightColor, Reply } from '../lib/types';
import { useLiveQuery } from './useLive';
import { queued } from './sync';

const annCol = (gid: string, bookId: string) => collection(db, 'groups', gid, 'books', bookId, 'annotations');
const repliesCol = (gid: string, bookId: string, aid: string) =>
  collection(db, 'groups', gid, 'books', bookId, 'annotations', aid, 'replies');

export function useAnnotations(gid: string, bookId: string) {
  return useLiveQuery<Annotation>(query(annCol(gid, bookId), orderBy('createdAt')), `ann:${gid}/${bookId}`);
}

export function useReplies(gid: string, bookId: string, aid: string | null) {
  return useLiveQuery<Reply>(
    aid ? query(repliesCol(gid, bookId, aid), orderBy('createdAt')) : null,
    `replies:${gid}/${bookId}/${aid}`,
  );
}

/** Returns the new id at once (the id is generated on the device); syncs when online. */
export function createAnnotation(
  gid: string,
  bookId: string,
  a: { authorId: string; type: AnnotationType; color: HighlightColor; text: string; url: string; anchor: Anchor },
): string {
  const ref = doc(annCol(gid, bookId));
  queued(setDoc(ref, { ...a, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }), 'Save annotation');
  return ref.id;
}

export const updateAnnotation = (
  gid: string,
  bookId: string,
  aid: string,
  patch: Partial<Pick<Annotation, 'color' | 'text' | 'url' | 'type'>>,
) => queued(updateDoc(doc(annCol(gid, bookId), aid), { ...patch, updatedAt: serverTimestamp() }), 'Edit annotation');

export const deleteAnnotation = (gid: string, bookId: string, aid: string) =>
  queued(deleteDoc(doc(annCol(gid, bookId), aid)), 'Delete annotation');

export const addReply = (gid: string, bookId: string, aid: string, authorId: string, text: string) =>
  queued(addDoc(repliesCol(gid, bookId, aid), { authorId, text, createdAt: serverTimestamp() }), 'Send reply');

export const deleteReply = (gid: string, bookId: string, aid: string, rid: string) =>
  queued(deleteDoc(doc(repliesCol(gid, bookId, aid), rid)), 'Delete reply');
