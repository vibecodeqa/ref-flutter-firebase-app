/// Shared, product-neutral domain code for the `flutter-firebase-app`
/// reference implementation.
///
/// Everything in this package is consumed by BOTH the end-user app
/// (`reference_app`) and the admin console (`reference_admin`). It deliberately
/// contains no Firebase initialisation and no credentials: it is the layer that
/// must stay identical on every client, and that Cloud Functions mirrors on the
/// server.
library;

export 'src/access_policy.dart';
export 'src/admin_claims.dart';
export 'src/note.dart';
