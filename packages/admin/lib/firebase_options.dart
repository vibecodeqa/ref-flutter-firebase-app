import 'package:firebase_core/firebase_core.dart';

/// Firebase **client** configuration for the admin console.
///
/// The admin console is a *separate Firebase app* inside the *same* Firebase
/// project as the end-user app: same `projectId`, different `appId`. That is
/// why this file exists instead of importing the app package's options — the
/// two clients are deployed separately and are versioned separately.
///
/// As with the end-user app, none of these values is a secret; see
/// `packages/app/lib/firebase_options.dart` and `SECURITY.md` for why. What
/// makes this console privileged is not a key it holds — it holds none — but
/// the `admin` custom claim on the signed-in user's ID token, which is minted
/// server-side and checked server-side.
class AdminFirebaseOptions {
  const AdminFirebaseOptions._();

  static const String environment = String.fromEnvironment('FIREBASE_ENV', defaultValue: 'dev');

  static const bool useEmulators = bool.fromEnvironment(
    'FIREBASE_USE_EMULATORS',
    defaultValue: environment == 'dev',
  );

  /// Deliberately the *same* define as the end-user app: one project per
  /// environment, two client apps inside it.
  static const String projectId = String.fromEnvironment(
    'FIREBASE_PROJECT_ID',
    defaultValue: 'demo-reference-flutter-firebase',
  );

  static const String apiKey = String.fromEnvironment(
    'FIREBASE_API_KEY',
    defaultValue: 'demo-api-key',
  );

  /// A *different* app ID from the end-user app.
  static const String appId = String.fromEnvironment(
    'FIREBASE_ADMIN_APP_ID',
    defaultValue: '1:000000000000:web:1111111111111111111111',
  );

  static const String messagingSenderId = String.fromEnvironment(
    'FIREBASE_MESSAGING_SENDER_ID',
    defaultValue: '000000000000',
  );

  static const String authDomain = String.fromEnvironment(
    'FIREBASE_AUTH_DOMAIN',
    defaultValue: 'demo-reference-flutter-firebase.firebaseapp.com',
  );

  static const List<String> declaredDefines = <String>[
    'FIREBASE_ENV',
    'FIREBASE_USE_EMULATORS',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_API_KEY',
    'FIREBASE_ADMIN_APP_ID',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_AUTH_DOMAIN',
  ];

  static FirebaseOptions get current => const FirebaseOptions(
    apiKey: apiKey,
    appId: appId,
    messagingSenderId: messagingSenderId,
    projectId: projectId,
    authDomain: authDomain,
  );
}
