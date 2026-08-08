import 'package:firebase_core/firebase_core.dart';

/// Firebase **client** configuration.
///
/// ## Why this file is not a secret
///
/// Everything in a `FirebaseOptions` object — API key, app ID, project ID,
/// messaging sender ID, storage bucket, auth domain — is shipped inside every
/// web bundle, APK and IPA. It is public by design. The Firebase API key is an
/// *identifier for a project*, not a bearer credential: it does not grant data
/// access on its own. Data access is decided by Firebase Auth, Firestore
/// security rules, Storage rules and App Check.
///
/// So: do not "fix" this file by moving it into a secret store. Moving public
/// config into secrets buys nothing and makes the build harder to reproduce.
/// What *must* stay out of the repo is on the other side of the boundary:
/// service-account JSON, Admin SDK credentials, FCM/VAPID private keys,
/// signing keystores, and Firebase CI deploy tokens. See `SECURITY.md`.
///
/// ## Why it still comes from `--dart-define`
///
/// Not for secrecy — for *environment separation*. The same source tree has to
/// build against the local emulator, a staging project and a production
/// project. Baking one project ID into source is how a debug build ends up
/// writing to production Firestore. Each value below is overridable at build
/// time and every build records what it used (see `docs/build-evidence.md`).
class DefaultFirebaseOptions {
  const DefaultFirebaseOptions._();

  /// `dev` (emulator), `staging`, or `prod`. Set with
  /// `--dart-define=FIREBASE_ENV=staging`.
  static const String environment = String.fromEnvironment('FIREBASE_ENV', defaultValue: 'dev');

  /// Whether to route Firebase traffic to the local emulator suite.
  /// Defaults to true in the `dev` environment and false everywhere else.
  static const bool useEmulators = bool.fromEnvironment(
    'FIREBASE_USE_EMULATORS',
    defaultValue: environment == 'dev',
  );

  static const String projectId = String.fromEnvironment(
    'FIREBASE_PROJECT_ID',
    defaultValue: 'demo-reference-flutter-firebase',
  );

  /// Public client API key. Empty in `dev` because the emulator does not check it.
  static const String apiKey = String.fromEnvironment(
    'FIREBASE_API_KEY',
    defaultValue: 'demo-api-key',
  );

  static const String appId = String.fromEnvironment(
    'FIREBASE_APP_ID',
    defaultValue: '1:000000000000:web:0000000000000000000000',
  );

  static const String messagingSenderId = String.fromEnvironment(
    'FIREBASE_MESSAGING_SENDER_ID',
    defaultValue: '000000000000',
  );

  static const String authDomain = String.fromEnvironment(
    'FIREBASE_AUTH_DOMAIN',
    defaultValue: 'demo-reference-flutter-firebase.firebaseapp.com',
  );

  static const String storageBucket = String.fromEnvironment(
    'FIREBASE_STORAGE_BUCKET',
    defaultValue: 'demo-reference-flutter-firebase.appspot.com',
  );

  /// Every environment define this app reads. `scripts/build-evidence.mjs`
  /// records the values actually used by a build, so a reviewer can tell which
  /// Firebase project an artifact talks to.
  static const List<String> declaredDefines = <String>[
    'FIREBASE_ENV',
    'FIREBASE_USE_EMULATORS',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_API_KEY',
    'FIREBASE_APP_ID',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_STORAGE_BUCKET',
  ];

  /// True when the build is pointed at a real (non-demo, non-emulator) project.
  static bool get isProductionShaped =>
      environment == 'prod' && !useEmulators && !projectId.startsWith('demo-');

  static FirebaseOptions get current => const FirebaseOptions(
    apiKey: apiKey,
    appId: appId,
    messagingSenderId: messagingSenderId,
    projectId: projectId,
    authDomain: authDomain,
    storageBucket: storageBucket,
  );
}
