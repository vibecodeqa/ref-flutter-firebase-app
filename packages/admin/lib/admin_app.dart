import 'package:flutter/material.dart';
import 'package:reference_shared/reference_shared.dart';

import 'moderation_service.dart';

/// Root widget of the admin console.
class AdminApp extends StatelessWidget {
  const AdminApp({required this.claims, required this.moderation, super.key});

  final AdminClaims claims;
  final ModerationService moderation;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Reference Admin',
      theme: ThemeData(colorSchemeSeed: Colors.deepPurple, useMaterial3: true),
      home: AdminGate(claims: claims, moderation: moderation),
    );
  }
}

/// Renders the moderation queue only for callers whose ID token carries the
/// `admin` custom claim.
///
/// This gate is a *UX* control. If it were removed, a hostile client would still
/// be stopped by `firestore.rules` on the read and by the callable Cloud
/// Function on the write. Both of those checks are proven by tests
/// (`firestore-tests/rules.test.mjs`, `packages/functions/src/policy.test.ts`).
class AdminGate extends StatelessWidget {
  const AdminGate({required this.claims, required this.moderation, super.key});

  final AdminClaims claims;
  final ModerationService moderation;

  @override
  Widget build(BuildContext context) {
    if (!claims.isSignedIn) {
      return const Scaffold(
        body: Center(key: Key('admin-signed-out'), child: Text('Sign in to continue.')),
      );
    }
    if (!claims.maySeeModerationQueue) {
      return const Scaffold(
        body: Center(
          key: Key('admin-forbidden'),
          child: Text('This account does not have the admin claim.'),
        ),
      );
    }
    return ModerationQueuePage(moderation: moderation);
  }
}

class ModerationQueuePage extends StatelessWidget {
  const ModerationQueuePage({required this.moderation, super.key});

  final ModerationService moderation;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Moderation queue')),
      body: StreamBuilder<List<Note>>(
        stream: moderation.watchQueue(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return const Center(key: Key('queue-error'), child: Text('Could not load the queue.'));
          }
          final data = snapshot.data;
          if (data == null) {
            return const Center(key: Key('queue-loading'), child: CircularProgressIndicator());
          }
          if (data.isEmpty) {
            return const Center(key: Key('queue-empty'), child: Text('Queue is clear.'));
          }
          return ListView.builder(
            key: const Key('queue-list'),
            itemCount: data.length,
            itemBuilder: (context, index) {
              final note = data[index];
              return ListTile(
                title: Text(note.title),
                subtitle: Text(note.body),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    IconButton(
                      key: Key('approve-${note.id}'),
                      icon: const Icon(Icons.check),
                      tooltip: 'Approve',
                      onPressed: () => moderation.setReviewState(note.id, ReviewState.approved),
                    ),
                    IconButton(
                      key: Key('reject-${note.id}'),
                      icon: const Icon(Icons.block),
                      tooltip: 'Reject',
                      onPressed: () => moderation.setReviewState(
                        note.id,
                        ReviewState.rejected,
                        reason: 'policy',
                      ),
                    ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}
