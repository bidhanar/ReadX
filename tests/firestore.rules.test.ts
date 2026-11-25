/**
 * Security rules tests. Run with:  npm run test:rules
 * (starts the Firestore emulator via firebase-tools and runs this file)
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

let env: RulesTestEnvironment;
const GID = 'g1';
const CODE = 'JOINME22';

const db = (uid: string | null): Firestore =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-readx',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

/** Seed: alice owns g1, bob is a member, carol is an outsider. */
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, 'groups', GID), { name: 'Club', ownerId: 'alice', inviteCode: CODE });
    await setDoc(doc(f, 'groups', GID, 'members', 'alice'), { uid: 'alice', role: 'owner', displayName: 'A', photoURL: null });
    await setDoc(doc(f, 'groups', GID, 'members', 'bob'), { uid: 'bob', role: 'member', displayName: 'B', photoURL: null, code: CODE });
    await setDoc(doc(f, 'invites', CODE), { groupId: GID });
    await setDoc(doc(f, 'groups', GID, 'books', 'b1'), {
      title: 'Book', author: '', format: 'pdf', filePath: 'books/x.pdf', size: 1, cover: null, uploadedBy: 'bob',
    });
    await setDoc(doc(f, 'groups', GID, 'books', 'b1', 'annotations', 'a1'), {
      authorId: 'bob', type: 'note', color: 'yellow', text: 'hi', url: '', anchor: { kind: 'pdf', page: 0, rects: [], quote: 'q' },
    });
  });
});

const annotation = (authorId: string) => ({
  authorId,
  type: 'highlight',
  color: 'green',
  text: '',
  url: '',
  anchor: { kind: 'pdf', page: 1, rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }], quote: 'q' },
  createdAt: serverTimestamp(),
});

describe('groups', () => {
  it('members can read the group; outsiders and anonymous users cannot', async () => {
    await assertSucceeds(getDoc(doc(db('bob'), 'groups', GID)));
    await assertFails(getDoc(doc(db('carol'), 'groups', GID)));
    await assertFails(getDoc(doc(db(null), 'groups', GID)));
  });

  it('anyone signed in can create a group with themselves as owner (atomic batch)', async () => {
    const f = db('carol');
    const b = writeBatch(f);
    b.set(doc(f, 'groups', 'g2'), { name: 'Mine', ownerId: 'carol', inviteCode: 'NEWCODE1' });
    b.set(doc(f, 'groups', 'g2', 'members', 'carol'), { uid: 'carol', role: 'owner', displayName: 'C', photoURL: null });
    b.set(doc(f, 'invites', 'NEWCODE1'), { groupId: 'g2' });
    await assertSucceeds(b.commit());
  });

  it('cannot create a group owned by someone else', async () => {
    const f = db('carol');
    const b = writeBatch(f);
    b.set(doc(f, 'groups', 'g3'), { name: 'Fake', ownerId: 'alice', inviteCode: 'X' });
    b.set(doc(f, 'groups', 'g3', 'members', 'carol'), { uid: 'carol', role: 'owner', displayName: 'C', photoURL: null });
    await assertFails(b.commit());
  });

  it('only the owner can rename; ownerId cannot change', async () => {
    await assertFails(updateDoc(doc(db('bob'), 'groups', GID), { name: 'Hacked' }));
    await assertSucceeds(updateDoc(doc(db('alice'), 'groups', GID), { name: 'Renamed' }));
    await assertFails(updateDoc(doc(db('alice'), 'groups', GID), { ownerId: 'bob' }));
  });

  it('only the owner sets the logo: a small embedded image, or none', async () => {
    const logo = 'data:image/webp;base64,' + 'A'.repeat(2000);
    await assertFails(updateDoc(doc(db('bob'), 'groups', GID), { logo }));
    await assertSucceeds(updateDoc(doc(db('alice'), 'groups', GID), { logo }));
    await assertSucceeds(updateDoc(doc(db('alice'), 'groups', GID), { logo: null }));
    // Links to other servers, other file types and oversized images are refused
    await assertFails(updateDoc(doc(db('alice'), 'groups', GID), { logo: 'https://tracker.example/pixel.png' }));
    await assertFails(updateDoc(doc(db('alice'), 'groups', GID), { logo: 'data:image/svg+xml;base64,PHN2Zz4=' }));
    await assertFails(updateDoc(doc(db('alice'), 'groups', GID), { logo: 'data:image/png;base64,' + 'A'.repeat(160000) }));
  });
});

describe('joining', () => {
  it('joins with a valid invite code', async () => {
    await assertSucceeds(
      setDoc(doc(db('carol'), 'groups', GID, 'members', 'carol'), { uid: 'carol', role: 'member', displayName: 'C', photoURL: null, code: CODE }),
    );
    await assertSucceeds(getDoc(doc(db('carol'), 'groups', GID)));
  });

  it('rejects a wrong code', async () => {
    await assertFails(
      setDoc(doc(db('carol'), 'groups', GID, 'members', 'carol'), { uid: 'carol', role: 'member', displayName: 'C', photoURL: null, code: 'NOPE' }),
    );
  });

  it('cannot join as owner, or add someone else', async () => {
    await assertFails(
      setDoc(doc(db('carol'), 'groups', GID, 'members', 'carol'), { uid: 'carol', role: 'owner', displayName: 'C', photoURL: null, code: CODE }),
    );
    await assertFails(
      setDoc(doc(db('carol'), 'groups', GID, 'members', 'dave'), { uid: 'dave', role: 'member', displayName: 'D', photoURL: null, code: CODE }),
    );
  });

  it('invites can be fetched by code but not listed', async () => {
    await assertSucceeds(getDoc(doc(db('carol'), 'invites', CODE)));
    await assertFails(getDocs(collection(db('carol'), 'invites')));
  });

  it('members cannot promote themselves', async () => {
    await assertFails(updateDoc(doc(db('bob'), 'groups', GID, 'members', 'bob'), { role: 'owner' }));
    await assertSucceeds(updateDoc(doc(db('bob'), 'groups', GID, 'members', 'bob'), { displayName: 'Bobby' }));
  });

  it('"my groups" collection-group query only returns my own memberships', async () => {
    await assertSucceeds(getDocs(query(collectionGroup(db('bob'), 'members'), where('uid', '==', 'bob'))));
    await assertFails(getDocs(query(collectionGroup(db('carol'), 'members'), where('uid', '==', 'bob'))));
  });

  it('a member can leave; the owner can remove others; members cannot remove others', async () => {
    await assertFails(deleteDoc(doc(db('bob'), 'groups', GID, 'members', 'alice')));
    await assertSucceeds(deleteDoc(doc(db('bob'), 'groups', GID, 'members', 'bob')));
    await assertFails(getDoc(doc(db('bob'), 'groups', GID)));
  });
});

describe('annotations', () => {
  const col = (uid: string) => collection(db(uid), 'groups', GID, 'books', 'b1', 'annotations');

  it('members can create their own; not as someone else; outsiders cannot', async () => {
    await assertSucceeds(addDoc(col('alice'), annotation('alice')));
    await assertFails(addDoc(col('alice'), annotation('bob')));
    await assertFails(addDoc(col('carol'), annotation('carol')));
  });

  it('only the author edits; author or group owner deletes', async () => {
    await assertFails(updateDoc(doc(col('alice'), 'a1'), { text: 'changed by alice' }));
    await assertSucceeds(updateDoc(doc(col('bob'), 'a1'), { text: 'edited' }));
    await assertFails(updateDoc(doc(col('bob'), 'a1'), { authorId: 'alice' }));
    await assertSucceeds(deleteDoc(doc(col('alice'), 'a1'))); // owner moderation
  });

  it('rejects unknown annotation types', async () => {
    await assertFails(addDoc(col('bob'), { ...annotation('bob'), type: 'scribble' }));
  });

  it('members can reply; outsiders cannot read', async () => {
    const replies = (uid: string) => collection(db(uid), 'groups', GID, 'books', 'b1', 'annotations', 'a1', 'replies');
    await assertSucceeds(addDoc(replies('alice'), { authorId: 'alice', text: 'agree', createdAt: serverTimestamp() }));
    await assertFails(getDocs(replies('carol')));
  });
});

describe('books, progress, chat, prefs', () => {
  it('uploader or owner can delete a book; other members cannot', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', GID, 'members', 'dave'), { uid: 'dave', role: 'member', displayName: 'D', photoURL: null });
    });
    await assertFails(deleteDoc(doc(db('dave'), 'groups', GID, 'books', 'b1')));
    await assertSucceeds(deleteDoc(doc(db('alice'), 'groups', GID, 'books', 'b1')));
  });

  it('members add books as themselves only', async () => {
    const book = { title: 'T', author: '', format: 'epub', filePath: 'books/y.epub', size: 1, cover: null, createdAt: serverTimestamp() };
    await assertSucceeds(addDoc(collection(db('bob'), 'groups', GID, 'books'), { ...book, uploadedBy: 'bob' }));
    await assertFails(addDoc(collection(db('bob'), 'groups', GID, 'books'), { ...book, uploadedBy: 'alice' }));
    await assertFails(addDoc(collection(db('bob'), 'groups', GID, 'books'), { ...book, uploadedBy: 'bob', format: 'exe' }));
  });

  it('progress: write only your own, members read all', async () => {
    const p = (uid: string, who: string) => doc(db(uid), 'groups', GID, 'books', 'b1', 'progress', who);
    await assertSucceeds(setDoc(p('bob', 'bob'), { uid: 'bob', location: 'p3', percent: 0.1 }));
    await assertFails(setDoc(p('bob', 'alice'), { uid: 'alice', location: 'p3', percent: 0.1 }));
    await assertSucceeds(getDoc(p('alice', 'bob')));
    await assertFails(getDoc(p('carol', 'bob')));
  });

  it('chat: members post as themselves; outsiders cannot read', async () => {
    const msgs = (uid: string) => collection(db(uid), 'groups', GID, 'messages');
    await assertSucceeds(addDoc(msgs('bob'), { authorId: 'bob', text: 'hello', ref: null, createdAt: serverTimestamp() }));
    await assertFails(addDoc(msgs('bob'), { authorId: 'alice', text: 'spoof', ref: null, createdAt: serverTimestamp() }));
    await assertFails(getDocs(msgs('carol')));
  });

  it('book prefs are private to the user', async () => {
    await assertSucceeds(setDoc(doc(db('bob'), 'users', 'bob', 'bookPrefs', 'b1'), { theme: 'dark' }));
    await assertFails(getDoc(doc(db('alice'), 'users', 'bob', 'bookPrefs', 'b1')));
  });
});
