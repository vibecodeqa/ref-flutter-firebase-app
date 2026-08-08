import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:reference_shared/reference_shared.dart';

import 'admin_app.dart';
import 'firebase_options.dart';
import 'moderation_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(options: AdminFirebaseOptions.current);

  final auth = FirebaseAuth.instance;
  final db = FirebaseFirestore.instance;
  final functions = FirebaseFunctions.instance;

  if (AdminFirebaseOptions.useEmulators) {
    db.useFirestoreEmulator('localhost', 8080);
    functions.useFunctionsEmulator('localhost', 5211);
    await auth.useAuthEmulator('localhost', 9099);
  }

  runApp(
    AdminApp(claims: await _readClaims(auth), moderation: FirebaseModerationService(db, functions)),
  );
}

/// Reads the `admin` custom claim out of the current ID token.
///
/// This only decides what the console *renders*. The server re-verifies the
/// same claim on every read (`firestore.rules`) and every write (the callable
/// Cloud Function).
Future<AdminClaims> _readClaims(FirebaseAuth auth) async {
  final user = auth.currentUser;
  if (user == null) return AdminClaims.anonymous;
  final token = await user.getIdTokenResult();
  return AdminClaims.fromToken(user.uid, token.claims ?? const <String, Object?>{});
}
