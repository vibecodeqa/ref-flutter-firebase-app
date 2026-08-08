import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reference_app/app.dart';
import 'package:reference_app/firebase_options.dart';
import 'package:reference_app/note_service.dart';
import 'package:reference_shared/reference_shared.dart';

/// A fake [NoteService] that records what the UI asked for.
class FakeNoteService implements NoteService {
  FakeNoteService([List<Note>? initial])
    : _controller = StreamController<List<Note>>.broadcast(),
      _initial = initial;

  final StreamController<List<Note>> _controller;
  final List<Note>? _initial;

  final List<String> watchedUids = <String>[];
  final List<Note> created = <Note>[];
  final List<Note> updated = <Note>[];

  @override
  Stream<List<Note>> watchOwnNotes(String uid) {
    watchedUids.add(uid);
    if (_initial != null) {
      scheduleMicrotask(() => _controller.add(_initial));
    }
    return _controller.stream;
  }

  @override
  Future<void> createNote(Note note) async => created.add(note);

  @override
  Future<void> updateOwnNote(Note note) async => updated.add(note);

  void emit(List<Note> notes) => _controller.add(notes);
  void fail(Object error) => _controller.addError(error);
  Future<void> dispose() => _controller.close();
}

Note _note(String id, {String owner = 'owner-1', ReviewState state = ReviewState.pending}) {
  return Note(
    id: id,
    ownerId: owner,
    title: 'Title $id',
    body: 'Body $id',
    visibility: NoteVisibility.private,
    createdAt: DateTime.utc(2026, 1, 1),
    reviewState: state,
  );
}

void main() {
  testWidgets('a signed-out visitor is asked to sign in and no query runs', (tester) async {
    final service = FakeNoteService();
    addTearDown(service.dispose);

    await tester.pumpWidget(ReferenceApp(notes: service, signedInUid: null));

    expect(find.byKey(const Key('signed-out')), findsOneWidget);
    expect(service.watchedUids, isEmpty);
  });

  testWidgets('a signed-in user only ever queries their own uid', (tester) async {
    final service = FakeNoteService(<Note>[]);
    addTearDown(service.dispose);

    await tester.pumpWidget(ReferenceApp(notes: service, signedInUid: 'owner-1'));
    await tester.pump();

    expect(service.watchedUids, <String>['owner-1']);
  });

  testWidgets('notes render with their moderation state', (tester) async {
    final service = FakeNoteService(<Note>[_note('a', state: ReviewState.approved), _note('b')]);
    addTearDown(service.dispose);

    await tester.pumpWidget(ReferenceApp(notes: service, signedInUid: 'owner-1'));
    await tester.pump();

    expect(find.byKey(const Key('notes-list')), findsOneWidget);
    expect(find.text('Title a'), findsOneWidget);
    expect(find.text('approved'), findsOneWidget);
    expect(find.text('pending'), findsOneWidget);
  });

  testWidgets('an empty result set is distinguishable from loading', (tester) async {
    final service = FakeNoteService();
    addTearDown(service.dispose);

    await tester.pumpWidget(ReferenceApp(notes: service, signedInUid: 'owner-1'));
    await tester.pump();
    expect(find.byKey(const Key('notes-loading')), findsOneWidget);

    service.emit(<Note>[]);
    await tester.pump();
    expect(find.byKey(const Key('notes-empty')), findsOneWidget);
  });

  testWidgets('a permission-denied stream surfaces an error state', (tester) async {
    final service = FakeNoteService();
    addTearDown(service.dispose);

    await tester.pumpWidget(ReferenceApp(notes: service, signedInUid: 'owner-1'));
    await tester.pump();

    service.fail(StateError('permission-denied'));
    await tester.pump();

    expect(find.byKey(const Key('notes-error')), findsOneWidget);
  });

  testWidgets('the build environment is visible in the UI', (tester) async {
    final service = FakeNoteService(<Note>[]);
    addTearDown(service.dispose);

    await tester.pumpWidget(
      ReferenceApp(notes: service, signedInUid: 'owner-1', environmentLabel: 'staging'),
    );
    await tester.pump();

    expect(tester.widget<Text>(find.byKey(const Key('environment-badge'))).data, 'staging');
  });

  group('DefaultFirebaseOptions', () {
    test('defaults to the emulator-backed demo project', () {
      expect(DefaultFirebaseOptions.environment, 'dev');
      expect(DefaultFirebaseOptions.useEmulators, isTrue);
      expect(DefaultFirebaseOptions.projectId, startsWith('demo-'));
      expect(DefaultFirebaseOptions.isProductionShaped, isFalse);
    });

    test('declares every define it reads', () {
      expect(DefaultFirebaseOptions.declaredDefines, contains('FIREBASE_PROJECT_ID'));
      expect(DefaultFirebaseOptions.declaredDefines, contains('FIREBASE_ENV'));
      expect(
        DefaultFirebaseOptions.declaredDefines.toSet().length,
        DefaultFirebaseOptions.declaredDefines.length,
        reason: 'declaredDefines must not contain duplicates',
      );
    });

    test('carries no private-key-shaped material', () {
      // Public client config is fine. Anything that looks like a service account
      // or a private key is not, and would be caught here as well as by
      // scripts/check-no-secrets.mjs.
      const values = <String>[
        DefaultFirebaseOptions.apiKey,
        DefaultFirebaseOptions.appId,
        DefaultFirebaseOptions.projectId,
        DefaultFirebaseOptions.storageBucket,
      ];
      for (final value in values) {
        expect(value, isNot(contains('BEGIN PRIVATE KEY')));
        expect(value, isNot(contains('service_account')));
      }
    });
  });
}
