import 'package:meta/meta.dart';

/// A read-only view of the custom claims on a Firebase ID token.
///
/// **This is not an authorisation decision.** A Flutter client can decode its
/// own ID token, and a hostile client can lie about what it decoded. The claim
/// is re-verified on every privileged path:
///
///  * `firestore.rules` reads `request.auth.token.admin` server-side, and
///  * the callable Cloud Function re-checks `request.auth.token.admin` before
///    performing any Admin SDK write.
///
/// The client-side copy exists only so the admin console can hide controls the
/// user would not be allowed to use. Hiding a button is a courtesy; the server
/// is the boundary.
@immutable
class AdminClaims {
  const AdminClaims({required this.isAdmin, required this.uid});

  /// Builds claims from the `claims` map of a Firebase ID token result.
  factory AdminClaims.fromToken(String uid, Map<String, Object?> claims) {
    return AdminClaims(uid: uid, isAdmin: claims['admin'] == true);
  }

  static const AdminClaims anonymous = AdminClaims(isAdmin: false, uid: '');

  final bool isAdmin;
  final String uid;

  bool get isSignedIn => uid.isNotEmpty;

  /// Whether the admin console should *render* privileged controls.
  bool get maySeeModerationQueue => isSignedIn && isAdmin;

  @override
  bool operator ==(Object other) =>
      other is AdminClaims && other.isAdmin == isAdmin && other.uid == uid;

  @override
  int get hashCode => Object.hash(isAdmin, uid);
}
