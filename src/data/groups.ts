import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  query,
  serverTimestamp,
  where,
  writeBatch,
  updateDoc,
  deleteDoc,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import type { Group, Member } from '../lib/types';
import { randomCode } from '../lib/util';
import { listenWithRetry, useLiveDoc, useLiveQuery } from './useLive';
import { NeedsInternetError, isOnline, queued } from './sync';

export const groupRef = (gid: string) => doc(db, 'groups', gid);
export const membersCol = (gid: string) => collection(db, 'groups', gid, 'members');

function memberFields(user: User) {
  return {
    uid: user.uid,
    displayName: user.displayName || user.email || 'Reader',
    photoURL: user.photoURL ?? null,
    joinedAt: serverTimestamp(),
  };
}

/** Works offline: the group appears immediately and is created on the server when back online. */
export function createGroup(user: User, name: string): string {
  const gref = doc(collection(db, 'groups'));
  const code = randomCode();
  const batch = writeBatch(db);
  batch.set(gref, { name: name.trim(), ownerId: user.uid, inviteCode: code, createdAt: serverTimestamp() });
  batch.set(doc(membersCol(gref.id), user.uid), { ...memberFields(user), role: 'owner' });
  batch.set(doc(db, 'invites', code), { groupId: gref.id });
  queued(batch.commit(), 'Create group');
  return gref.id;
}

/** Returns the group id joined. Throws if the code is invalid. */
export async function joinGroup(user: User, rawCode: string): Promise<string> {
  const code = rawCode.trim().toUpperCase();
  // The invite has to be checked against the server; a cached miss would look like a bad code
  if (!isOnline()) throw new NeedsInternetError('Joining a group');
  const inv = await getDoc(doc(db, 'invites', code));
  if (!inv.exists()) throw new Error('That invite code is not valid (it may have been reset).');
  const gid = inv.data().groupId as string;
  const batch = writeBatch(db);
  batch.set(doc(membersCol(gid), user.uid), { ...memberFields(user), role: 'member', code });
  try {
    await batch.commit();
  } catch (e) {
    // Already a member → creating again is an update, which the rules forbid. Treat as success.
    const mine = await getDoc(doc(membersCol(gid), user.uid)).catch(() => null);
    if (mine?.exists()) return gid;
    throw e;
  }
  return gid;
}

export function resetInvite(group: Group): string {
  const code = randomCode();
  const batch = writeBatch(db);
  batch.update(groupRef(group.id), { inviteCode: code });
  batch.set(doc(db, 'invites', code), { groupId: group.id });
  batch.delete(doc(db, 'invites', group.inviteCode));
  queued(batch.commit(), 'Reset invite code');
  return code;
}

export const renameGroup = (gid: string, name: string) =>
  queued(updateDoc(groupRef(gid), { name: name.trim() }), 'Rename group');
/** Owner only. `logo`: a small data URL from squareLogo(), or null to remove it. */
export const setGroupLogo = (gid: string, logo: string | null) =>
  queued(updateDoc(groupRef(gid), { logo }), 'Change group logo');
export const removeMember = (gid: string, uid: string) =>
  queued(deleteDoc(doc(membersCol(gid), uid)), 'Remove member');

export function useGroup(gid: string | undefined) {
  return useLiveDoc<Group>(gid ? groupRef(gid) : null, `group:${gid}`);
}

export function useMembers(gid: string | undefined) {
  return useLiveQuery<Member & { id: string }>(
    gid ? query(membersCol(gid), orderBy('joinedAt')) : null,
    `members:${gid}`,
  );
}

/** Groups the user belongs to: live collection-group query on members, then each parent group. */
export function useMyGroups(uid: string) {
  const [state, setState] = useState<{ groups: Group[]; loading: boolean; error: Error | null }>({
    groups: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const groupUnsubs = new Map<string, () => void>();
    const groupData = new Map<string, Group>();
    let memberIds: string[] = [];
    let pending = new Set<string>();

    const emit = () => {
      const groups = memberIds
        .map((id) => groupData.get(id))
        .filter((g): g is Group => !!g)
        .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      setState({ groups, loading: pending.size > 0, error: null });
    };

    const unsubMembers = onSnapshot(
      query(collectionGroup(db, 'members'), where('uid', '==', uid)),
      (snap) => {
        memberIds = snap.docs.map((d) => d.ref.parent.parent!.id);
        // Subscribe to new groups, drop removed ones
        for (const [id, unsub] of groupUnsubs) {
          if (!memberIds.includes(id)) {
            unsub();
            groupUnsubs.delete(id);
            groupData.delete(id);
          }
        }
        pending = new Set(memberIds.filter((id) => !groupData.has(id)));
        for (const id of memberIds) {
          if (groupUnsubs.has(id)) continue;
          groupUnsubs.set(
            id,
            listenWithRetry(
              (onError) =>
                onSnapshot(
                  groupRef(id),
                  (g) => {
                    if (g.exists()) groupData.set(id, { id, ...(g.data({ serverTimestamps: 'estimate' }) as Omit<Group, 'id'>) });
                    else groupData.delete(id);
                    pending.delete(id);
                    emit();
                  },
                  onError,
                ),
              () => {
                pending.delete(id);
                emit();
              },
            ),
          );
        }
        emit();
      },
      (error) => setState({ groups: [], loading: false, error }),
    );

    return () => {
      unsubMembers();
      groupUnsubs.forEach((u) => u());
    };
  }, [uid]);

  return state;
}
