/**
 * Trust-boundary policy for the reference implementation's Cloud Functions.
 *
 * Everything in this file is a pure function. That is deliberate: the rules that
 * decide who may mutate what should be testable without an emulator, without
 * network access and without the Firebase Admin SDK. `index.ts` is the thin
 * adapter that turns these decisions into `HttpsError`s and Firestore writes.
 */

/**
 * Fields on a `notes` document that only this trusted backend may write.
 *
 * Kept in sync with `NoteFieldPolicy.serverOnlyFields` in `packages/shared` and
 * with `serverOnlyNoteFields()` in `firestore.rules`. `policy.test.ts` reads
 * `firestore.rules` and fails if the two ever drift.
 */
export const SERVER_ONLY_NOTE_FIELDS = ['reviewState', 'reviewedBy', 'reviewedAt'] as const;

export const REVIEW_STATES = ['pending', 'approved', 'rejected'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export type PolicyErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument';

/** A transport-agnostic failure that `index.ts` maps onto an `HttpsError`. */
export class PolicyError extends Error {
  constructor(
    readonly code: PolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PolicyError';
  }
}

/** The shape of `request.auth` that a callable handler receives. */
export interface CallerAuth {
  uid?: unknown;
  token?: Record<string, unknown>;
}

export interface Caller {
  uid: string;
  isAdmin: boolean;
}

/**
 * Re-verifies the caller's identity and `admin` custom claim.
 *
 * The client-side gate in `packages/admin` is a courtesy. This is the boundary.
 * Note the strict `=== true`: a claim of `"true"`, `1` or `{}` is not admin.
 */
export function requireAdmin(auth: CallerAuth | null | undefined): Caller {
  if (!auth || typeof auth.uid !== 'string' || auth.uid.length === 0) {
    throw new PolicyError('unauthenticated', 'Sign in before calling this function.');
  }
  const isAdmin = auth.token?.admin === true;
  if (!isAdmin) {
    throw new PolicyError('permission-denied', 'This operation requires the admin claim.');
  }
  return { uid: auth.uid, isAdmin };
}

/** Verifies the caller is signed in, without requiring elevation. */
export function requireSignedIn(auth: CallerAuth | null | undefined): Caller {
  if (!auth || typeof auth.uid !== 'string' || auth.uid.length === 0) {
    throw new PolicyError('unauthenticated', 'Sign in before calling this function.');
  }
  return { uid: auth.uid, isAdmin: auth.token?.admin === true };
}

export interface ReviewRequest {
  noteId: string;
  reviewState: ReviewState;
  reason?: string;
}

const NOTE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Validates and narrows an untrusted callable payload. */
export function parseReviewRequest(data: unknown): ReviewRequest {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new PolicyError('invalid-argument', 'Expected an object payload.');
  }
  const payload = data as Record<string, unknown>;

  const allowed = new Set(['noteId', 'reviewState', 'reason']);
  const unexpected = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new PolicyError('invalid-argument', `Unexpected field(s): ${unexpected.join(', ')}`);
  }

  const noteId = payload.noteId;
  if (typeof noteId !== 'string' || !NOTE_ID.test(noteId)) {
    throw new PolicyError('invalid-argument', 'noteId must be a short document id.');
  }

  const reviewState = payload.reviewState;
  if (typeof reviewState !== 'string' || !isReviewState(reviewState)) {
    throw new PolicyError(
      'invalid-argument',
      `reviewState must be one of: ${REVIEW_STATES.join(', ')}`,
    );
  }

  const reason = payload.reason;
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) {
    throw new PolicyError('invalid-argument', 'reason must be a string of at most 500 chars.');
  }

  return reason === undefined
    ? { noteId, reviewState }
    : { noteId, reviewState, reason };
}

export function isReviewState(value: string): value is ReviewState {
  return (REVIEW_STATES as readonly string[]).includes(value);
}

export interface ReviewUpdate {
  reviewState: ReviewState;
  reviewedBy: string;
  reviewedAt: string;
}

/**
 * Builds the Firestore patch for a moderation decision.
 *
 * The patch touches server-owned fields *only*. A trusted backend that also
 * rewrote `title` or `ownerId` would be silently overriding the owner, so the
 * returned key set is asserted in tests.
 */
export function buildReviewUpdate(
  request: ReviewRequest,
  caller: Caller,
  now: Date,
): ReviewUpdate {
  return {
    reviewState: request.reviewState,
    reviewedBy: caller.uid,
    reviewedAt: now.toISOString(),
  };
}

export interface ModerationEvent {
  noteId: string;
  reviewState: ReviewState;
  actorUid: string;
  reason: string | null;
  at: string;
}

/** Builds the append-only audit record for a moderation decision. */
export function buildModerationEvent(
  request: ReviewRequest,
  caller: Caller,
  now: Date,
): ModerationEvent {
  return {
    noteId: request.noteId,
    reviewState: request.reviewState,
    actorUid: caller.uid,
    reason: request.reason ?? null,
    at: now.toISOString(),
  };
}

/** True when a patch touches a field a client is not allowed to write. */
export function touchesServerOnlyField(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).some((key) =>
    (SERVER_ONLY_NOTE_FIELDS as readonly string[]).includes(key),
  );
}
