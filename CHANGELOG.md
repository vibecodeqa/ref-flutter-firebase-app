# Changelog

All notable changes to this reference implementation are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-08-09

### Added

- Melos workspace (`melos.yaml`, `packages/*`) with three Flutter/Dart packages —
  `reference_app`, `reference_admin`, `reference_shared` — plus a Node 22
  TypeScript Cloud Functions package at `packages/functions`.
- Public Firebase client configuration driven by `--dart-define`, documented as
  public by design in `packages/app/lib/firebase_options.dart` and `SECURITY.md`.
- `firestore.rules` enforcing owner/shared/admin reads and a client-versus-server
  write boundary, with 32 emulator-backed unit tests in `firestore-tests/`.
- Callable Cloud Functions (`setNoteReviewState`, `requestNoteReview`) owning the
  privileged writes that `firestore.rules` forbids every client from performing,
  with 24 pure-policy unit tests.
- Cross-runtime consistency tests: the server-owned field list is asserted
  identical in Dart, in `firestore.rules` and in TypeScript.
- `firestore.queries.json` + `scripts/check-firestore-indexes.mjs`, which prove
  every declared composite query has a matching index and no index is unused.
- `scripts/check-no-secrets.mjs` (tracked files) and
  `scripts/check-bundle-secrets.mjs` (built web bundles) for committed-credential
  and shipped-credential negative evidence.
- `scripts/build-evidence.mjs`, recording Flutter version, commit, environment
  defines, artifact hashes and platform permissions for every build.
- `.github/workflows/ci.yml` with six required blocking gates and
  `.github/workflows/deploy.yml`, gated on those gates, whose deploy step is
  permanently disabled.
- `docs/vcqa-report.md` and `docs/build-evidence.md`.

[Unreleased]: https://github.com/vibecodeqa/ref-flutter-firebase-app/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vibecodeqa/ref-flutter-firebase-app/releases/tag/v0.1.0
