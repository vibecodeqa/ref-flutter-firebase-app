import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:reference_shared/reference_shared.dart';

/// The admin console's view of the moderation queue.
///
/// Reads go straight to Firestore, because `firestore.rules` can express
/// "an admin may read any note" from the `admin` custom claim. Writes do not:
/// `reviewState` is a server-owned field and no client may write it, so every
/// mutation goes through a callable Cloud Function that re-verifies the claim
/// and writes with the Admin SDK.
abstract class ModerationService {
  /// Notes waiting for review, oldest first.
  Stream<List<Note>> watchQueue();

  /// Sets the review state of a note. Must go through the trusted backend.
  Future<void> setReviewState(String noteId, ReviewState state, {String? reason});
}

class FirebaseModerationService implements ModerationService {
  FirebaseModerationService(this._db, this._functions);

  final FirebaseFirestore _db;
  final FirebaseFunctions _functions;

  @override
  Stream<List<Note>> watchQueue() {
    // Declared in `firestore.queries.json`, backed by a composite index.
    return _db
        .collection('notes')
        .where('reviewState', isEqualTo: ReviewState.pending.name)
        .orderBy('createdAt')
        .limit(100)
        .snapshots()
        .map((snap) => snap.docs.map((d) => Note.fromMap(d.id, d.data())).toList());
  }

  @override
  Future<void> setReviewState(String noteId, ReviewState state, {String? reason}) async {
    // There is deliberately no Firestore write path here. `firestore.rules`
    // would reject it, and `packages/admin/test/no_direct_write_test.dart`
    // fails the build if one is ever added.
    await _functions.httpsCallable('setNoteReviewState').call<void>(<String, Object?>{
      'noteId': noteId,
      'reviewState': state.name,
      'reason': ?reason,
    });
  }
}
