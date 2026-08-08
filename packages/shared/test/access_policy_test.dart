import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reference_shared/reference_shared.dart';

/// Resolves a path relative to the repository root, whichever directory
/// `flutter test` was started from.
File _repoFile(String relative) {
  var dir = Directory.current;
  for (var i = 0; i < 6; i++) {
    final candidate = File('${dir.path}/$relative');
    if (candidate.existsSync()) return candidate;
    final parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  throw StateError('Could not locate $relative from ${Directory.current.path}');
}

void main() {
  group('NoteFieldPolicy stays in sync with firestore.rules', () {
    late String rules;

    setUpAll(() {
      rules = _repoFile('firestore.rules').readAsStringSync();
    });

    test('every server-only field is named in the rules', () {
      for (final field in NoteFieldPolicy.serverOnlyFields) {
        expect(
          rules.contains("'$field'"),
          isTrue,
          reason: '$field is server-only in Dart but is not named in firestore.rules',
        );
      }
    });

    test('the rules serverOnlyNoteFields list matches the Dart list exactly', () {
      final match = RegExp(
        r'function serverOnlyNoteFields\(\)\s*\{\s*return \[(.*?)\];',
        dotAll: true,
      ).firstMatch(rules);
      expect(match, isNotNull, reason: 'firestore.rules must declare serverOnlyNoteFields()');
      final fromRules = match!
          .group(1)!
          .split(',')
          .map((s) => s.trim().replaceAll("'", ''))
          .where((s) => s.isNotEmpty)
          .toList();
      expect(fromRules, equals(NoteFieldPolicy.serverOnlyFields));
    });

    test('the rules client-writable lists match the Dart lists exactly', () {
      String listFrom(String fn) {
        final m = RegExp(
          'function $fn'
          r'\(\)\s*\{\s*return \[(.*?)\];',
          dotAll: true,
        ).firstMatch(rules);
        expect(m, isNotNull, reason: 'firestore.rules must declare $fn()');
        return m!.group(1)!;
      }

      List<String> parse(String raw) => raw
          .split(',')
          .map((s) => s.trim().replaceAll("'", ''))
          .where((s) => s.isNotEmpty)
          .toList();

      expect(
        parse(listFrom('clientCreatableNoteFields')),
        equals(NoteFieldPolicy.clientCreatableFields),
      );
      expect(
        parse(listFrom('clientUpdatableNoteFields')),
        equals(NoteFieldPolicy.clientUpdatableFields),
      );
    });

    test('no server-only field is client-writable', () {
      for (final field in NoteFieldPolicy.serverOnlyFields) {
        expect(NoteFieldPolicy.clientCreatableFields, isNot(contains(field)));
        expect(NoteFieldPolicy.clientUpdatableFields, isNot(contains(field)));
      }
    });
  });

  group('AccessPolicy', () {
    final note = Note(
      id: 'n1',
      ownerId: 'owner-1',
      title: 'Title',
      body: 'Body',
      visibility: NoteVisibility.private,
      createdAt: DateTime.utc(2026, 1, 1),
    );

    test('an anonymous viewer reads nothing', () {
      expect(AccessPolicy.canRead(note, viewerUid: null), isFalse);
    });

    test('a non-owner cannot read a private note', () {
      expect(AccessPolicy.canRead(note, viewerUid: 'someone-else'), isFalse);
    });

    test('the owner reads its own private note', () {
      expect(AccessPolicy.canRead(note, viewerUid: 'owner-1'), isTrue);
    });

    test('a signed-in stranger reads a shared note', () {
      final sharedNote = note.copyWith(visibility: NoteVisibility.shared);
      expect(AccessPolicy.canRead(sharedNote, viewerUid: 'someone-else'), isTrue);
    });

    test('an admin reads a private note it does not own', () {
      expect(AccessPolicy.canRead(note, viewerUid: 'admin-1', viewerIsAdmin: true), isTrue);
    });

    test('a non-owner cannot edit', () {
      expect(AccessPolicy.canClientEdit(note, viewerUid: 'someone-else'), isFalse);
    });
  });

  group('payload construction never carries server-owned fields', () {
    final note = Note(
      id: 'n1',
      ownerId: 'owner-1',
      title: 'Title',
      body: 'Body',
      visibility: NoteVisibility.private,
      createdAt: DateTime.utc(2026, 1, 1),
      reviewState: ReviewState.approved,
      reviewedBy: 'admin-1',
    );

    test('create payload omits server-owned fields', () {
      final payload = note.toCreatePayload();
      expect(AccessPolicy.touchesServerOnlyField(payload), isFalse);
      expect(payload.keys, unorderedEquals(NoteFieldPolicy.clientCreatableFields));
    });

    test('update payload omits server-owned fields', () {
      final payload = note.toClientUpdatePayload();
      expect(AccessPolicy.touchesServerOnlyField(payload), isFalse);
      expect(payload.keys, unorderedEquals(NoteFieldPolicy.clientUpdatableFields));
    });

    test('a hand-built payload with reviewState is detected', () {
      expect(
        AccessPolicy.touchesServerOnlyField(<String, Object?>{'reviewState': 'approved'}),
        isTrue,
      );
      expect(
        AccessPolicy.isClientWritablePayload(<String, Object?>{'reviewState': 'approved'}),
        isFalse,
      );
    });
  });

  group('AdminClaims', () {
    test('an absent claim is not admin', () {
      expect(AdminClaims.fromToken('u1', const <String, Object?>{}).isAdmin, isFalse);
    });

    test('a truthy-but-not-true claim is not admin', () {
      expect(
        AdminClaims.fromToken('u1', const <String, Object?>{'admin': 'true'}).isAdmin,
        isFalse,
      );
    });

    test('admin == true is admin', () {
      final claims = AdminClaims.fromToken('u1', const <String, Object?>{'admin': true});
      expect(claims.isAdmin, isTrue);
      expect(claims.maySeeModerationQueue, isTrue);
    });

    test('an anonymous caller never sees the moderation queue', () {
      expect(AdminClaims.anonymous.maySeeModerationQueue, isFalse);
    });
  });

  group('Note wire decoding', () {
    test('decodes a full Firestore payload', () {
      final note = Note.fromMap('n1', <String, Object?>{
        'ownerId': 'owner-1',
        'title': 'T',
        'body': 'B',
        'visibility': 'shared',
        'createdAt': '2026-01-01T00:00:00Z',
        'reviewState': 'approved',
        'reviewedBy': 'admin-1',
      });
      expect(note.visibility, NoteVisibility.shared);
      expect(note.reviewState, ReviewState.approved);
      expect(note.reviewedBy, 'admin-1');
    });

    test('falls back to the safe default for unknown values', () {
      final note = Note.fromMap('n1', <String, Object?>{
        'ownerId': 'owner-1',
        'visibility': 'world-readable',
        'reviewState': 'whatever',
      });
      expect(note.visibility, NoteVisibility.private);
      expect(note.reviewState, ReviewState.pending);
    });
  });
}
