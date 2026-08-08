import 'note.dart';

/// The single declaration of which `notes` fields a client may write and which
/// belong to the server.
///
/// This list is duplicated on purpose in three places, because three different
/// runtimes have to agree on it:
///
///  1. here, so the Flutter clients never build a payload containing them,
///  2. `firestore.rules`, so the database refuses them regardless of client,
///  3. `packages/functions/src/policy.ts`, so the trusted path knows what it owns.
///
/// Duplication across runtimes is unavoidable; *undetected divergence* is not.
/// `packages/shared/test/access_policy_test.dart` reads `firestore.rules` and
/// fails if the two lists drift apart.
class NoteFieldPolicy {
  const NoteFieldPolicy._();

  /// Fields a signed-in owner may set when creating a note.
  static const List<String> clientCreatableFields = <String>[
    'ownerId',
    'title',
    'body',
    'visibility',
    'createdAt',
  ];

  /// Fields a signed-in owner may change on an existing note.
  static const List<String> clientUpdatableFields = <String>['title', 'body', 'visibility'];

  /// Fields that only a Cloud Function using the Admin SDK may write.
  ///
  /// A client holding an `admin: true` custom claim still cannot write these
  /// directly: the claim gates *reading* the moderation queue, while the write
  /// itself has to go through the callable Function.
  static const List<String> serverOnlyFields = <String>['reviewState', 'reviewedBy', 'reviewedAt'];
}

/// Client-side mirror of the read rules in `firestore.rules`.
///
/// This is a *UX affordance*, not a security control. It exists so the app can
/// avoid issuing reads that Firestore is going to reject anyway. The
/// authoritative decision is always made by `firestore.rules` on the server.
class AccessPolicy {
  const AccessPolicy._();

  /// Whether [viewerUid] can be expected to read [note].
  static bool canRead(Note note, {String? viewerUid, bool viewerIsAdmin = false}) {
    if (viewerUid == null) return false;
    if (viewerIsAdmin) return true;
    if (note.ownerId == viewerUid) return true;
    return note.visibility == NoteVisibility.shared;
  }

  /// Whether [viewerUid] can be expected to edit [note] directly.
  static bool canClientEdit(Note note, {String? viewerUid}) {
    if (viewerUid == null) return false;
    return note.ownerId == viewerUid;
  }

  /// Whether a payload only touches fields a client is allowed to write.
  static bool isClientWritablePayload(Map<String, Object?> payload) {
    return payload.keys.every(
      (key) =>
          NoteFieldPolicy.clientCreatableFields.contains(key) ||
          NoteFieldPolicy.clientUpdatableFields.contains(key),
    );
  }

  /// Whether a payload tries to write a server-owned field.
  static bool touchesServerOnlyField(Map<String, Object?> payload) {
    return payload.keys.any(NoteFieldPolicy.serverOnlyFields.contains);
  }
}
