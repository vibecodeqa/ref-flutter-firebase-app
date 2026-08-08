/**
 * Cloud Functions for the flutter-firebase-app reference implementation.
 *
 * These functions exist because some mutations cannot be performed safely by a
 * client, no matter what claim the client holds:
 *
 *  * `setNoteReviewState` writes `reviewState`/`reviewedBy`/`reviewedAt`, which
 *    `firestore.rules` forbids every client from writing, and appends an
 *    audit record to a collection no client may write at all.
 *  * `requestNoteReview` lets an owner ask for review without letting the owner
 *    decide the outcome.
 *
 * The Admin SDK bypasses security rules by design. That is exactly why the
 * checks below are not optional: this file *is* the enforcement point for
 * everything the rules cannot express.
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';

import {
  PolicyError,
  buildModerationEvent,
  buildReviewUpdate,
  parseReviewRequest,
  requireAdmin,
  requireSignedIn,
} from './policy';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const db = getFirestore();

/** Maps a transport-agnostic PolicyError onto the callable error contract. */
function toHttpsError(error: unknown): HttpsError {
  if (error instanceof PolicyError) {
    return new HttpsError(error.code, error.message);
  }
  // Never leak an internal message to a client.
  console.error('unhandled function error', error);
  return new HttpsError('internal', 'The request could not be completed.');
}

export const setNoteReviewState = onCall(async (request: CallableRequest) => {
  try {
    const caller = requireAdmin(request.auth);
    const parsed = parseReviewRequest(request.data);
    const now = new Date();

    const noteRef = db.collection('notes').doc(parsed.noteId);
    const snapshot = await noteRef.get();
    if (!snapshot.exists) {
      throw new PolicyError('invalid-argument', 'No such note.');
    }

    const batch = db.batch();
    // Merge, not replace: the patch is a closed record of the three server-owned
    // fields (proven by policy.test.ts), and the note is known to exist because
    // the read above returned. Owner-controlled fields are untouched.
    batch.set(noteRef, buildReviewUpdate(parsed, caller, now), { merge: true });
    batch.set(db.collection('moderationEvents').doc(), {
      ...buildModerationEvent(parsed, caller, now),
      recordedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return { noteId: parsed.noteId, reviewState: parsed.reviewState };
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const requestNoteReview = onCall(async (request: CallableRequest) => {
  try {
    const caller = requireSignedIn(request.auth);
    const data = request.data as { noteId?: unknown } | null;
    const parsed = parseReviewRequest({
      noteId: data?.noteId,
      reviewState: 'pending',
    });

    const noteRef = db.collection('notes').doc(parsed.noteId);
    const snapshot = await noteRef.get();
    if (!snapshot.exists) {
      throw new PolicyError('invalid-argument', 'No such note.');
    }
    // An owner may ask for review of their own note, and only their own.
    if (snapshot.get('ownerId') !== caller.uid) {
      throw new PolicyError('permission-denied', 'You do not own this note.');
    }

    await noteRef.set(
      buildReviewUpdate(parsed, { uid: 'system', isAdmin: true }, new Date()),
      { merge: true },
    );
    return { noteId: parsed.noteId, reviewState: 'pending' };
  } catch (error) {
    throw toHttpsError(error);
  }
});
