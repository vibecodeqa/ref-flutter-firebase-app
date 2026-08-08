import 'package:flutter/material.dart';
import 'package:reference_shared/reference_shared.dart';

import 'firebase_options.dart';
import 'note_service.dart';

/// The root widget.
///
/// It takes its [NoteService] by injection so widget tests can drive it with a
/// fake and never touch Firebase.
class ReferenceApp extends StatelessWidget {
  const ReferenceApp({
    required this.notes,
    required this.signedInUid,
    super.key,
    this.environmentLabel = DefaultFirebaseOptions.environment,
  });

  final NoteService notes;
  final String? signedInUid;
  final String environmentLabel;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Reference App',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: NotesPage(notes: notes, signedInUid: signedInUid, environmentLabel: environmentLabel),
    );
  }
}

class NotesPage extends StatelessWidget {
  const NotesPage({
    required this.notes,
    required this.signedInUid,
    required this.environmentLabel,
    super.key,
  });

  final NoteService notes;
  final String? signedInUid;
  final String environmentLabel;

  @override
  Widget build(BuildContext context) {
    final uid = signedInUid;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your notes'),
        actions: <Widget>[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Center(child: Text(environmentLabel, key: const Key('environment-badge'))),
          ),
        ],
      ),
      body: uid == null
          ? const Center(key: Key('signed-out'), child: Text('Sign in to see your notes.'))
          : StreamBuilder<List<Note>>(
              stream: notes.watchOwnNotes(uid),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return const Center(
                    key: Key('notes-error'),
                    child: Text('Could not load notes.'),
                  );
                }
                final data = snapshot.data;
                if (data == null) {
                  return const Center(
                    key: Key('notes-loading'),
                    child: CircularProgressIndicator(),
                  );
                }
                if (data.isEmpty) {
                  return const Center(key: Key('notes-empty'), child: Text('No notes yet.'));
                }
                return ListView.builder(
                  key: const Key('notes-list'),
                  itemCount: data.length,
                  itemBuilder: (context, index) {
                    final note = data[index];
                    return ListTile(
                      title: Text(note.title),
                      subtitle: Text(note.body),
                      trailing: Text(note.reviewState.name),
                    );
                  },
                );
              },
            ),
    );
  }
}
