import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reference_admin/admin_app.dart';
import 'package:reference_admin/firebase_options.dart';
import 'package:reference_admin/moderation_service.dart';
import 'package:reference_shared/reference_shared.dart';

class FakeModerationService implements ModerationService {
  FakeModerationService([List<Note>? initial])
    : _controller = StreamController<List<Note>>.broadcast(),
      _initial = initial;

  final StreamController<List<Note>> _controller;
  final List<Note>? _initial;

  int watchCount = 0;
  final List<Map<String, Object?>> calls = <Map<String, Object?>>[];

  @override
  Stream<List<Note>> watchQueue() {
    watchCount++;
    if (_initial != null) {
      scheduleMicrotask(() => _controller.add(_initial));
    }
    return _controller.stream;
  }

  @override
  Future<void> setReviewState(String noteId, ReviewState state, {String? reason}) async {
    calls.add(<String, Object?>{'noteId': noteId, 'state': state.name, 'reason': reason});
  }

  Future<void> dispose() => _controller.close();
}

Note _pending(String id) => Note(
  id: id,
  ownerId: 'owner-$id',
  title: 'Title $id',
  body: 'Body $id',
  visibility: NoteVisibility.shared,
  createdAt: DateTime.utc(2026, 1, 1),
);

void main() {
  testWidgets('an anonymous caller is asked to sign in and no queue read happens', (tester) async {
    final service = FakeModerationService();
    addTearDown(service.dispose);

    await tester.pumpWidget(AdminApp(claims: AdminClaims.anonymous, moderation: service));

    expect(find.byKey(const Key('admin-signed-out')), findsOneWidget);
    expect(service.watchCount, 0);
  });

  testWidgets('a signed-in caller without the admin claim is refused', (tester) async {
    final service = FakeModerationService();
    addTearDown(service.dispose);

    await tester.pumpWidget(
      AdminApp(claims: AdminClaims.fromToken('u1', const <String, Object?>{}), moderation: service),
    );

    expect(find.byKey(const Key('admin-forbidden')), findsOneWidget);
    expect(service.watchCount, 0);
  });

  testWidgets('a caller with the admin claim sees the queue', (tester) async {
    final service = FakeModerationService(<Note>[_pending('a')]);
    addTearDown(service.dispose);

    await tester.pumpWidget(
      AdminApp(
        claims: AdminClaims.fromToken('admin-1', const <String, Object?>{'admin': true}),
        moderation: service,
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('queue-list')), findsOneWidget);
    expect(find.text('Title a'), findsOneWidget);
  });

  testWidgets('approving a note calls the trusted backend, not a Firestore write', (tester) async {
    final service = FakeModerationService(<Note>[_pending('a')]);
    addTearDown(service.dispose);

    await tester.pumpWidget(
      AdminApp(
        claims: AdminClaims.fromToken('admin-1', const <String, Object?>{'admin': true}),
        moderation: service,
      ),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('approve-a')));
    await tester.pump();

    expect(service.calls, hasLength(1));
    expect(service.calls.single['noteId'], 'a');
    expect(service.calls.single['state'], 'approved');
  });

  testWidgets('rejecting a note sends a reason', (tester) async {
    final service = FakeModerationService(<Note>[_pending('a')]);
    addTearDown(service.dispose);

    await tester.pumpWidget(
      AdminApp(
        claims: AdminClaims.fromToken('admin-1', const <String, Object?>{'admin': true}),
        moderation: service,
      ),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('reject-a')));
    await tester.pump();

    expect(service.calls.single['state'], 'rejected');
    expect(service.calls.single['reason'], 'policy');
  });

  testWidgets('a denied queue read surfaces an error state', (tester) async {
    final service = FakeModerationService();
    addTearDown(service.dispose);

    await tester.pumpWidget(
      AdminApp(
        claims: AdminClaims.fromToken('admin-1', const <String, Object?>{'admin': true}),
        moderation: service,
      ),
    );
    await tester.pump();
    service._controller.addError(StateError('permission-denied'));
    await tester.pump();

    expect(find.byKey(const Key('queue-error')), findsOneWidget);
  });

  group('AdminFirebaseOptions', () {
    test('shares the project with the end-user app but not the app id', () {
      expect(AdminFirebaseOptions.projectId, 'demo-reference-flutter-firebase');
      expect(AdminFirebaseOptions.declaredDefines, contains('FIREBASE_ADMIN_APP_ID'));
      expect(AdminFirebaseOptions.declaredDefines, contains('FIREBASE_PROJECT_ID'));
    });

    test('defaults to the emulator suite', () {
      expect(AdminFirebaseOptions.environment, 'dev');
      expect(AdminFirebaseOptions.useEmulators, isTrue);
    });
  });
}
