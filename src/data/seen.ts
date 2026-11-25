import { doc, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { db } from '../lib/firebase';
import { useLiveDoc } from './useLive';
import { queued } from './sync';

/**
 * "Last seen" markers for unread badges (chat, new notes). Stored per user in Firestore
 * (users/{uid}/seen/{key}) so they sync across devices and work offline.
 *
 * Keys: `chat_{gid}`, `notes_{gid}_{bookId}`.
 */
const seenRef = (uid: string, key: string) => doc(db, 'users', uid, 'seen', key);

export function useSeen(uid: string, key: string) {
  const live = useLiveDoc<{ at?: Timestamp }>(seenRef(uid, key), `seen:${uid}/${key}`);
  const lastWrite = useRef(0);

  const markSeen = useCallback(() => {
    // Throttle: opening a panel and new items arriving can call this in quick succession
    if (Date.now() - lastWrite.current < 1500) return;
    lastWrite.current = Date.now();
    queued(setDoc(seenRef(uid, key), { at: serverTimestamp() }), 'Mark as read');
  }, [uid, key]);

  // First visit: start from "now" so everything already there doesn't show up as new
  const missing = !live.loading && !live.data && !live.error;
  useEffect(() => {
    if (missing) markSeen();
  }, [missing, markSeen]);

  const seenAt = live.data?.at?.toMillis() ?? null;
  return { seenAt, ready: !live.loading && seenAt !== null, markSeen };
}

/** Items by other people created after `seenAt`. */
export function useUnread<T extends { authorId: string; createdAt?: Timestamp }>(
  items: T[],
  myUid: string,
  seenAt: number | null,
): T[] {
  return useMemo(
    () => (seenAt === null ? [] : items.filter((i) => i.authorId !== myUid && (i.createdAt?.toMillis() ?? 0) > seenAt)),
    [items, myUid, seenAt],
  );
}
