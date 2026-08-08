import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PolicyError,
  REVIEW_STATES,
  SERVER_ONLY_NOTE_FIELDS,
  buildModerationEvent,
  buildReviewUpdate,
  parseReviewRequest,
  requireAdmin,
  requireSignedIn,
  touchesServerOnlyField,
} from './policy';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const ADMIN = { uid: 'admin-1', token: { admin: true } };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof PolicyError) return error.code;
    return `unexpected:${String(error)}`;
  }
  return 'no-error';
}

describe('requireAdmin', () => {
  it('rejects an unauthenticated caller', () => {
    expect(codeOf(() => requireAdmin(null))).toBe('unauthenticated');
    expect(codeOf(() => requireAdmin(undefined))).toBe('unauthenticated');
    expect(codeOf(() => requireAdmin({ token: { admin: true } }))).toBe('unauthenticated');
  });

  it('rejects a signed-in caller with no admin claim', () => {
    expect(codeOf(() => requireAdmin({ uid: 'u1', token: {} }))).toBe('permission-denied');
    expect(codeOf(() => requireAdmin({ uid: 'u1' }))).toBe('permission-denied');
  });

  it('rejects claim values that merely look truthy', () => {
    for (const value of ['true', 1, {}, [], 'admin']) {
      expect(codeOf(() => requireAdmin({ uid: 'u1', token: { admin: value } }))).toBe(
        'permission-denied',
      );
    }
  });

  it('accepts admin === true', () => {
    expect(requireAdmin(ADMIN)).toEqual({ uid: 'admin-1', isAdmin: true });
  });
});

describe('requireSignedIn', () => {
  it('rejects anonymous callers', () => {
    expect(codeOf(() => requireSignedIn(null))).toBe('unauthenticated');
    expect(codeOf(() => requireSignedIn({ uid: '' }))).toBe('unauthenticated');
  });

  it('accepts a plain signed-in caller and reports no elevation', () => {
    expect(requireSignedIn({ uid: 'u1' })).toEqual({ uid: 'u1', isAdmin: false });
  });
});

describe('parseReviewRequest', () => {
  it('accepts a well-formed payload', () => {
    expect(parseReviewRequest({ noteId: 'note-1', reviewState: 'approved' })).toEqual({
      noteId: 'note-1',
      reviewState: 'approved',
    });
  });

  it('rejects non-object payloads', () => {
    for (const payload of [null, undefined, 'note-1', 42, ['note-1']]) {
      expect(codeOf(() => parseReviewRequest(payload))).toBe('invalid-argument');
    }
  });

  it('rejects unexpected fields instead of ignoring them', () => {
    expect(
      codeOf(() =>
        parseReviewRequest({ noteId: 'n1', reviewState: 'approved', ownerId: 'someone-else' }),
      ),
    ).toBe('invalid-argument');
  });

  it('rejects an attempt to smuggle server-owned fields through the callable', () => {
    for (const field of SERVER_ONLY_NOTE_FIELDS) {
      expect(
        codeOf(() => parseReviewRequest({ noteId: 'n1', reviewState: 'approved', [field]: 'x' })),
      ).toBe('invalid-argument');
    }
  });

  it('rejects a malformed note id', () => {
    for (const noteId of ['', 'a/b', '../../etc/passwd', 'x'.repeat(129), 7, null]) {
      expect(codeOf(() => parseReviewRequest({ noteId, reviewState: 'approved' }))).toBe(
        'invalid-argument',
      );
    }
  });

  it('rejects a review state outside the enum', () => {
    expect(codeOf(() => parseReviewRequest({ noteId: 'n1', reviewState: 'deleted' }))).toBe(
      'invalid-argument',
    );
  });

  it('rejects an over-long reason', () => {
    expect(
      codeOf(() =>
        parseReviewRequest({ noteId: 'n1', reviewState: 'rejected', reason: 'x'.repeat(501) }),
      ),
    ).toBe('invalid-argument');
  });

  it('keeps a short reason', () => {
    expect(
      parseReviewRequest({ noteId: 'n1', reviewState: 'rejected', reason: 'spam' }).reason,
    ).toBe('spam');
  });
});

describe('buildReviewUpdate', () => {
  const now = new Date('2026-08-09T00:00:00.000Z');
  const update = buildReviewUpdate(
    { noteId: 'n1', reviewState: 'approved' },
    { uid: 'admin-1', isAdmin: true },
    now,
  );

  it('writes only server-owned fields', () => {
    expect(Object.keys(update).sort()).toEqual([...SERVER_ONLY_NOTE_FIELDS].sort());
  });

  it('never rewrites owner-controlled content', () => {
    expect(update).not.toHaveProperty('title');
    expect(update).not.toHaveProperty('body');
    expect(update).not.toHaveProperty('ownerId');
    expect(update).not.toHaveProperty('visibility');
  });

  it('stamps the acting admin and the time', () => {
    expect(update.reviewedBy).toBe('admin-1');
    expect(update.reviewedAt).toBe('2026-08-09T00:00:00.000Z');
  });
});

describe('buildModerationEvent', () => {
  it('records who did what, when, and why', () => {
    const event = buildModerationEvent(
      { noteId: 'n1', reviewState: 'rejected', reason: 'spam' },
      { uid: 'admin-1', isAdmin: true },
      new Date('2026-08-09T00:00:00.000Z'),
    );
    expect(event).toEqual({
      noteId: 'n1',
      reviewState: 'rejected',
      actorUid: 'admin-1',
      reason: 'spam',
      at: '2026-08-09T00:00:00.000Z',
    });
  });

  it('normalises a missing reason to null rather than dropping the field', () => {
    const event = buildModerationEvent(
      { noteId: 'n1', reviewState: 'approved' },
      { uid: 'admin-1', isAdmin: true },
      new Date(0),
    );
    expect(event.reason).toBeNull();
  });
});

describe('the server-only field list is the same in every runtime', () => {
  const rules = readFileSync(join(REPO_ROOT, 'firestore.rules'), 'utf8');

  it('matches firestore.rules', () => {
    const match = /function serverOnlyNoteFields\(\)\s*\{\s*return \[(.*?)\];/s.exec(rules);
    expect(match, 'firestore.rules must declare serverOnlyNoteFields()').not.toBeNull();
    const fromRules = match![1]!
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean);
    expect(fromRules).toEqual([...SERVER_ONLY_NOTE_FIELDS]);
  });

  it('matches the Dart shared package', () => {
    const dart = readFileSync(
      join(REPO_ROOT, 'packages', 'shared', 'lib', 'src', 'access_policy.dart'),
      'utf8',
    );
    const match = /serverOnlyFields = <String>\[(.*?)\];/s.exec(dart);
    expect(match, 'packages/shared must declare serverOnlyFields').not.toBeNull();
    const fromDart = match![1]!
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean);
    expect(fromDart).toEqual([...SERVER_ONLY_NOTE_FIELDS]);
  });
});

describe('touchesServerOnlyField', () => {
  it('flags a patch that touches a server-owned field', () => {
    expect(touchesServerOnlyField({ reviewState: 'approved' })).toBe(true);
  });

  it('leaves a client-shaped patch alone', () => {
    expect(touchesServerOnlyField({ title: 't', body: 'b' })).toBe(false);
  });
});

describe('REVIEW_STATES', () => {
  it('matches the Dart ReviewState enum', () => {
    const dart = readFileSync(
      join(REPO_ROOT, 'packages', 'shared', 'lib', 'src', 'note.dart'),
      'utf8',
    );
    const match = /enum ReviewState \{([\s\S]*?);/.exec(dart);
    expect(match, 'packages/shared must declare enum ReviewState').not.toBeNull();
    const fromDart = match![1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(fromDart).toEqual([...REVIEW_STATES]);
  });
});
