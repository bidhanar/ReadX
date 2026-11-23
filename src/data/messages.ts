import { addDoc, collection, deleteDoc, doc, limitToLast, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Message } from '../lib/types';
import { useLiveQuery } from './useLive';
import { queued } from './sync';

const msgCol = (gid: string) => collection(db, 'groups', gid, 'messages');

export function useMessages(gid: string, max = 300) {
  return useLiveQuery<Message>(query(msgCol(gid), orderBy('createdAt'), limitToLast(max)), `msgs:${gid}:${max}`);
}

/** Shows in the chat at once; delivered when online (the message shows a clock until then). */
export const sendMessage = (gid: string, authorId: string, text: string, ref: Message['ref'] = null) =>
  queued(addDoc(msgCol(gid), { authorId, text, ref, createdAt: serverTimestamp() }), 'Send message');

export const deleteMessage = (gid: string, mid: string) => queued(deleteDoc(doc(msgCol(gid), mid)), 'Delete message');
