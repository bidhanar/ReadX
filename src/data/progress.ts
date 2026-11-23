import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Progress } from '../lib/types';
import { useLiveQuery } from './useLive';
import { queued } from './sync';

const progCol = (gid: string, bookId: string) => collection(db, 'groups', gid, 'books', bookId, 'progress');

export function useProgress(gid: string, bookId: string) {
  return useLiveQuery<Progress & { id: string }>(progCol(gid, bookId), `prog:${gid}/${bookId}`);
}

export const saveProgress = (gid: string, bookId: string, uid: string, location: string, percent: number) =>
  queued(setDoc(doc(progCol(gid, bookId), uid), { uid, location, percent, updatedAt: serverTimestamp() }), 'Save reading position');
