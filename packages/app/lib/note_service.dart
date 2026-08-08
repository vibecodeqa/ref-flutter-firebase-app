import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:reference_shared/reference_shared.dart';

/// The seam the UI talks to.
///
/// Keeping the UI behind this interface is what makes the widget tests runnable
/// without a Firebase app, an emulator, or network access — the CI "app tests"
/// gate stays fast and deterministic.
abstract class NoteService {
  /// Notes the signed-in user owns, newest first.
  Stream<List<Note>> watchOwnNotes(String uid);

  /// Creates a note owned by [uid].
  Future<void> createNote(Note note);

  /// Edits the client-writable fields of a note the caller owns.
  Future<void> updateOwnNote(Note note);
}

/// The real Firestore-backed implementation.
class FirestoreNoteService implements NoteService {
  FirestoreNoteService(this._db);

  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> get _notes => _db.collection('notes');

  @override
  Stream<List<Note>> watchOwnNotes(String uid) {
    // This composite query is declared in `firestore.queries.json` and backed by
    // an index in `firestore.indexes.json`; CI fails if the two drift apart.
    return _notes
        .where('ownerId', isEqualTo: uid)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snap) => snap.docs.map((d) => Note.fromMap(d.id, d.data())).toList());
  }

  @override
  Future<void> createNote(Note note) {
    final payload = note.toCreatePayload();
    _assertClientWritable(payload);
    return _notes.doc(note.id).set(payload);
  }

  @override
  Future<void> updateOwnNote(Note note) {
    final payload = note.toClientUpdatePayload();
    _assertClientWritable(payload);
    return _notes.doc(note.id).update(payload);
  }

  /// Client-side belt to the server's braces.
  ///
  /// `firestore.rules` already rejects these writes. This assertion exists so
  /// the failure shows up in a test or a debug build as a clear programming
  /// error instead of an opaque `permission-denied` at runtime.
  void _assertClientWritable(Map<String, Object?> payload) {
    if (AccessPolicy.touchesServerOnlyField(payload)) {
      throw StateError(
        'Refusing to write server-owned fields from a client: '
        '${payload.keys.where(NoteFieldPolicy.serverOnlyFields.contains).join(', ')}. '
        'Use the moderateNote callable Cloud Function instead.',
      );
    }
  }
}

/// The privileged path.
///
/// Moderation changes `reviewState`, which no client may write — not even a
/// client whose token carries `admin: true`. The only way through is this
/// callable Cloud Function, which re-verifies the claim server-side and then
/// writes with the Admin SDK.
class ModerationClient {
  ModerationClient(this._functions);

  final FirebaseFunctions _functions;

  Future<void> requestReview(String noteId) async {
    await _functions.httpsCallable('requestNoteReview').call<void>(<String, Object?>{
      'noteId': noteId,
    });
  }
}
