/**
 * Firestore security rules unit tests.
 *
 * These run against the Firestore emulator (a Java process — CI installs a JDK)
 * launched by `firebase emulators:exec`. They are a required CI gate, because
 * `firestore.rules` is a deployable artifact: it is the only thing standing
 * between a hostile client and the database, and it cannot be reviewed by
 * reading it alone.
 *
 * The two rules that matter most, and are asserted here explicitly:
 *
 *   1. a non-owner cannot read another user's private note, and
 *   2. no client — not even one holding the `admin` claim — can write the
 *      `reviewState` field that the Cloud Function owns.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');
const OWNER = 'owner-1';
const STRANGER = 'stranger-1';
const ADMIN = 'admin-1';

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let testEnv;

const ownerNote = {
  ownerId: OWNER,
  title: 'Private note',
  body: 'Body',
  visibility: 'private',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const sharedNote = { ...ownerNote, title: 'Shared note', visibility: 'shared' };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: {
      rules: readFileSync(join(REPO_ROOT, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'notes/private-1'), { ...ownerNote, reviewState: 'pending' });
    await setDoc(doc(db, 'notes/shared-1'), { ...sharedNote, reviewState: 'approved' });
    await setDoc(doc(db, 'moderationEvents/e1'), {
      noteId: 'private-1',
      reviewState: 'approved',
      actorUid: ADMIN,
      reason: null,
      at: '2026-01-02T00:00:00.000Z',
    });
  });
});

const anon = () => testEnv.unauthenticatedContext().firestore();
const owner = () => testEnv.authenticatedContext(OWNER).firestore();
const stranger = () => testEnv.authenticatedContext(STRANGER).firestore();
const admin = () => testEnv.authenticatedContext(ADMIN, { admin: true }).firestore();
/** A client that *claims* to be an admin in its own payload but has no claim. */
const fakeAdmin = () => testEnv.authenticatedContext(STRANGER, { admin: 'true' }).firestore();

describe('notes: read', () => {
  it('denies an unauthenticated read', async () => {
    await assertFails(getDoc(doc(anon(), 'notes/private-1')));
  });

  it('denies a non-owner reading a private note', async () => {
    await assertFails(getDoc(doc(stranger(), 'notes/private-1')));
  });

  it('allows the owner to read its own private note', async () => {
    await assertSucceeds(getDoc(doc(owner(), 'notes/private-1')));
  });

  it('allows a signed-in stranger to read a shared note', async () => {
    await assertSucceeds(getDoc(doc(stranger(), 'notes/shared-1')));
  });

  it('allows an admin claim to read any note', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'notes/private-1')));
  });

  it('denies a caller whose admin claim is the string "true"', async () => {
    await assertFails(getDoc(doc(fakeAdmin(), 'notes/private-1')));
  });

  it('denies a non-owner listing the whole collection', async () => {
    await assertFails(getDocs(collection(stranger(), 'notes')));
  });

  it('allows an admin to list the collection', async () => {
    await assertSucceeds(getDocs(collection(admin(), 'notes')));
  });
});

describe('notes: create', () => {
  it('allows an owner to create a well-formed note', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'notes/new-1'), ownerNote));
  });

  it('denies creating a note owned by somebody else', async () => {
    await assertFails(setDoc(doc(stranger(), 'notes/new-2'), ownerNote));
  });

  it('denies creating a note that carries a server-owned field', async () => {
    await assertFails(
      setDoc(doc(owner(), 'notes/new-3'), { ...ownerNote, reviewState: 'approved' }),
    );
    await assertFails(setDoc(doc(owner(), 'notes/new-4'), { ...ownerNote, reviewedBy: OWNER }));
    await assertFails(
      setDoc(doc(owner(), 'notes/new-5'), { ...ownerNote, reviewedAt: '2026-01-01' }),
    );
  });

  it('denies an unknown extra field', async () => {
    await assertFails(setDoc(doc(owner(), 'notes/new-6'), { ...ownerNote, isFeatured: true }));
  });

  it('denies an invalid visibility value', async () => {
    await assertFails(setDoc(doc(owner(), 'notes/new-7'), { ...ownerNote, visibility: 'public' }));
  });

  it('denies an empty title', async () => {
    await assertFails(setDoc(doc(owner(), 'notes/new-8'), { ...ownerNote, title: '' }));
  });
});

describe('notes: update — the client/server write boundary', () => {
  it('allows an owner to edit its own title and body', async () => {
    await assertSucceeds(
      updateDoc(doc(owner(), 'notes/private-1'), { title: 'Edited', body: 'New body' }),
    );
  });

  it('DENIES an owner writing the Function-owned reviewState field', async () => {
    await assertFails(updateDoc(doc(owner(), 'notes/private-1'), { reviewState: 'approved' }));
  });

  it('DENIES an admin-claim client writing reviewState directly', async () => {
    // This is the rule that forces moderation through the callable Cloud
    // Function. An admin may *read* everything; it may not *write* the field.
    await assertFails(updateDoc(doc(admin(), 'notes/private-1'), { reviewState: 'approved' }));
    await assertFails(updateDoc(doc(admin(), 'notes/private-1'), { reviewedBy: ADMIN }));
  });

  it('denies an owner reassigning ownership', async () => {
    await assertFails(updateDoc(doc(owner(), 'notes/private-1'), { ownerId: STRANGER }));
  });

  it('denies a stranger editing a note it does not own', async () => {
    await assertFails(updateDoc(doc(stranger(), 'notes/shared-1'), { title: 'Hijacked' }));
  });

  it('denies an owner setting an invalid visibility', async () => {
    await assertFails(updateDoc(doc(owner(), 'notes/private-1'), { visibility: 'public' }));
  });
});

describe('notes: delete', () => {
  it('allows the owner to delete its own note', async () => {
    await assertSucceeds(deleteDoc(doc(owner(), 'notes/private-1')));
  });

  it('denies a stranger deleting somebody else’s note', async () => {
    await assertFails(deleteDoc(doc(stranger(), 'notes/private-1')));
  });

  it('denies an admin deleting a note from a client', async () => {
    await assertFails(deleteDoc(doc(admin(), 'notes/private-1')));
  });
});

describe('moderationEvents: an append-only audit trail nobody writes from a client', () => {
  it('allows an admin to read the audit trail', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'moderationEvents/e1')));
  });

  it('denies a non-admin reading the audit trail', async () => {
    await assertFails(getDoc(doc(stranger(), 'moderationEvents/e1')));
    await assertFails(getDoc(doc(owner(), 'moderationEvents/e1')));
  });

  it('denies every client write, including an admin', async () => {
    await assertFails(setDoc(doc(admin(), 'moderationEvents/e2'), { noteId: 'x' }));
    await assertFails(updateDoc(doc(admin(), 'moderationEvents/e1'), { reason: 'changed' }));
    await assertFails(deleteDoc(doc(admin(), 'moderationEvents/e1')));
  });
});

describe('users', () => {
  it('allows a user to create its own profile with allowed fields only', async () => {
    await assertSucceeds(
      setDoc(doc(owner(), `users/${OWNER}`), { displayName: 'Owner', locale: 'en' }),
    );
  });

  it('denies writing another user profile', async () => {
    await assertFails(setDoc(doc(stranger(), `users/${OWNER}`), { displayName: 'Nope' }));
  });

  it('denies an unexpected field such as a self-granted role', async () => {
    await assertFails(
      setDoc(doc(owner(), `users/${OWNER}`), { displayName: 'Owner', admin: true }),
    );
  });

  it('denies deleting a profile from any client', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `users/${OWNER}`), { displayName: 'Owner' });
    });
    await assertFails(deleteDoc(doc(owner(), `users/${OWNER}`)));
  });
});

describe('the rules file itself', () => {
  it('pins rules_version 2', () => {
    const rules = readFileSync(join(REPO_ROOT, 'firestore.rules'), 'utf8');
    expect(rules).toMatch(/^rules_version = '2';/m);
  });

  it('contains no blanket allow', () => {
    const rules = readFileSync(join(REPO_ROOT, 'firestore.rules'), 'utf8');
    expect(rules).not.toMatch(/allow read, write: if true/);
    expect(rules).not.toMatch(/allow read, write;/);
  });
});
