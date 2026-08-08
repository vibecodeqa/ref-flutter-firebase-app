import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'firebase_options.dart';
import 'note_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(options: DefaultFirebaseOptions.current);

  final db = FirebaseFirestore.instance;
  final auth = FirebaseAuth.instance;

  // Environment separation is a build-time decision, not a runtime guess.
  // A `dev` build talks to the emulator suite on the ports pinned in
  // firebase.json; nothing else does.
  if (DefaultFirebaseOptions.useEmulators) {
    db.useFirestoreEmulator('localhost', 8080);
    await auth.useAuthEmulator('localhost', 9099);
  }

  runApp(ReferenceApp(notes: FirestoreNoteService(db), signedInUid: auth.currentUser?.uid));
}
