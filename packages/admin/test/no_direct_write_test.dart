import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reference_shared/reference_shared.dart';

/// Structural tests for the privileged boundary.
///
/// The admin console is the most dangerous client in this workspace: it is the
/// one whose users legitimately hold an elevated claim. The rule this file
/// enforces is that elevation never turns into a *direct database write*. All
/// moderation goes through a callable Cloud Function, which re-verifies the
/// claim with the Admin SDK.
///
/// This is a source-level check, deliberately. It fails at review time, before
/// anyone has to notice a `permission-denied` in production logs.
void main() {
  final libDir = Directory('lib');
  final sources = libDir
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .toList();

  test('the admin package has source files to inspect', () {
    expect(sources, isNotEmpty);
  });

  test('the admin package performs no direct Firestore document write', () {
    final writeCall = RegExp(r'\.(set|update|add|delete)\(');
    final offenders = <String>[];
    for (final file in sources) {
      final lines = file.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        if (line.trimLeft().startsWith('//')) continue;
        if (writeCall.hasMatch(line)) {
          offenders.add('${file.path}:${i + 1}: ${line.trim()}');
        }
      }
    }
    expect(
      offenders,
      isEmpty,
      reason:
          'The admin console must mutate data only through callable Cloud '
          'Functions. Offending lines:\n${offenders.join('\n')}',
    );
  });

  test('the admin package never names a server-owned field in a write payload', () {
    for (final file in sources) {
      final text = file.readAsStringSync();
      for (final field in NoteFieldPolicy.serverOnlyFields) {
        // `reviewState` may be *read* and may be sent as a callable argument,
        // but must never appear next to a Firestore write.
        final bad = RegExp("\\.(set|update)\\([^)]*$field");
        expect(
          bad.hasMatch(text),
          isFalse,
          reason: '${file.path} writes the server-owned field "$field" directly',
        );
      }
    }
  });

  test('the admin package holds no service-account or private-key material', () {
    const forbidden = <String>[
      'BEGIN PRIVATE KEY',
      'service_account',
      'firebase-adminsdk',
      'GOOGLE_APPLICATION_CREDENTIALS',
    ];
    for (final file in sources) {
      final text = file.readAsStringSync();
      for (final needle in forbidden) {
        expect(
          text.contains(needle),
          isFalse,
          reason:
              '${file.path} contains "$needle"; server credentials never ship '
              'in a client bundle',
        );
      }
    }
  });
}
