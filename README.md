# ref-flutter-firebase-app

A **product-neutral reference implementation** of the VibeCode QA
`flutter-firebase-app` stack: a Melos workspace holding a Flutter end-user app,
a Flutter admin console and a shared Dart package, backed by Firebase Auth,
Firestore, Hosting and Node 22 Cloud Functions.

It exists so a rubric can be judged against something real. Every rule the stack
charter names — workspace shape, environment separation, Firestore rules and
index tests, client config versus server secrets, trusted Functions boundaries,
platform build evidence, deploy gates — is demonstrated here by code and by a
check that fails when the demonstration stops being true.

- Standard charter: <https://vibecodeqa.online/docs/standards/stacks/flutter-firebase-app/>
- Assessment report: [`docs/vcqa-report.md`](docs/vcqa-report.md)
- Build evidence: [`docs/build-evidence.md`](docs/build-evidence.md)
- Security boundary: [`SECURITY.md`](SECURITY.md)

There is no product here. The domain is a `notes` collection with an owner, a
visibility flag and a moderation state. It is deliberately the smallest domain
that still has a real client/server trust boundary.

## Layout

```
melos.yaml                    Melos workspace (packages/*)
pubspec.yaml                  workspace root; pins the Melos version
firebase.json                 Hosting (2 targets) + Functions + emulator ports
.firebaserc                   dev / staging / prod project aliases
firestore.rules               the enforced access boundary (emulator-tested)
firestore.indexes.json        deployable composite indexes
firestore.queries.json        every composite query, declared and cross-checked
firestore-tests/              @firebase/rules-unit-testing suite (32 tests)
packages/
  app/                        Flutter end-user client       (reference_app)
  admin/                      Flutter admin console (web)   (reference_admin)
  shared/                     shared Dart models + policy   (reference_shared)
  functions/                  Node 22 TypeScript Cloud Functions
scripts/                      committed checks CI runs as required gates
.github/workflows/ci.yml      six required blocking gates
.github/workflows/deploy.yml  gated, and permanently disabled (see below)
```

## The one idea this repo is built around

There is exactly one field group that no client may write: `reviewState`,
`reviewedBy`, `reviewedAt` on a note. Everything else follows from it.

1. **`packages/shared`** declares the field list in `NoteFieldPolicy`, so
   neither Flutter client can build a payload containing it by accident.
2. **`firestore.rules`** refuses the write, for *every* caller — including one
   whose ID token carries `admin: true`. An admin may read everything; an admin
   may not write these fields.
3. **`packages/functions`** owns the only path that can: a callable Cloud
   Function that re-verifies the claim server-side and writes with the Admin
   SDK, which bypasses rules by design.
4. Three tests prove the three runtimes still agree on the same list — a Dart
   test, a TypeScript test and the rules suite. Drift fails the build.
5. A structural test (`packages/admin/test/no_direct_write_test.dart`) fails if
   anyone ever adds a direct Firestore write to the admin console.

That is the seam the `flutter-firebase-app` standard exists to judge: the
combination of a public client, a rules file, a shared model and a trusted
backend — not any one of them alone.

## Firebase client config is public. On purpose.

`packages/app/lib/firebase_options.dart` and
`packages/admin/lib/firebase_options.dart` contain API keys, app IDs and project
IDs, and they are committed deliberately. Those values ship inside every web
bundle, APK and IPA; a Firebase API key identifies a project and is not a bearer
credential. Access is decided by Auth, security rules and App Check.

**Do not "fix" this as a leak.** The values that must never be committed —
service accounts, Admin SDK keys, VAPID private keys, deploy tokens, keystores —
are listed in [`SECURITY.md`](SECURITY.md) and enforced by two committed checks:

- `scripts/check-no-secrets.mjs` — scans every git-tracked file (a `.gitignore`
  entry is not evidence; `git add -f` defeats it).
- `scripts/check-bundle-secrets.mjs` — scans the **built** web bundles, because
  a source-clean repo can still ship a key introduced at build time.

Config still comes from `--dart-define` — not for secrecy, but for environment
separation, so the same tree can build against the emulator, staging or
production and record which one it used.

## Running it locally

Requires Flutter 3.41.8 (stable), Node 22+ and a JDK 11+ (the Firestore emulator
is a Java process).

```bash
# Dart/Flutter workspace
dart pub global activate melos 6.3.2     # see "Why Melos 6" below
dart pub get                             # resolve the workspace root
melos bootstrap
melos run analyze     --no-select        # flutter analyze --fatal-infos, all packages
melos run format:check --no-select
melos run test        --no-select        # app + admin + shared

# Cloud Functions
npm --prefix packages/functions ci
npm --prefix packages/functions run typecheck
npm --prefix packages/functions test

# Firestore rules, against the emulator
npm ci
npm run test:rules:emulated

# Static gates
npm run check                            # secrets + indexes + deploy shape

# Web builds
cd packages/app   && flutter build web --release --dart-define=FIREBASE_ENV=dev
cd packages/admin && flutter build web --release --dart-define=FIREBASE_ENV=dev
```

Emulator ports are pinned in `firebase.json` (auth 9099, firestore 8080,
functions 5211, hosting 5210) so local runs, CI and the rules tests always agree.

## What CI proves

`.github/workflows/ci.yml` runs six jobs. **All six are required and blocking;
none uses `continue-on-error`, and there are no reporting-only jobs.**
`scripts/check-deploy-shape.mjs` enforces that, plus SHA-pinning of every
third-party action and a minimum 30-minute timeout per job.

| Job | What it proves |
|---|---|
| `static-checks` | no credential-shaped file or content is tracked; every composite query has an index and no index is unused; the deploy workflow is gated, credential-free and correctly ordered |
| `flutter-workspace` | `melos bootstrap` resolves the workspace; `flutter analyze --fatal-infos` and `dart format` are clean across all three packages; app, admin and shared tests pass as separately named steps |
| `functions` | Node 22 `npm ci`, strict `tsc` typecheck (tests included), 24 trust-boundary unit tests, and a real build of the deployable bundle |
| `firestore-rules` | 32 rules tests run against a real Firestore emulator (JDK installed explicitly), including "a non-owner cannot read" and "no client can write the Function-owned fields" |
| `web-build` | both Flutter web bundles compile in release mode with explicit `--dart-define`s; build evidence is recorded and uploaded; the shipped bundles contain no server credentials |
| `android-build-shape` | the Android toolchain compiles a debug APK, and the declared platform permissions are captured as evidence |

### What the mobile check proves — and what it does not

`android-build-shape` runs `flutter build apk --debug`. That is a **real
compile**: it exercises the Android SDK, Gradle, the Android Gradle Plugin, the
manifest merge, Firebase plugin registration and Dart-to-ARM compilation. If a
plugin is incompatible or the manifest is malformed, this job goes red.

It does **not** prove:

- release signing (this repo holds no keystore, by design — see `SECURITY.md`),
- R8/ProGuard shrinking or a release-mode build,
- an App Bundle (`.aab`) or any store upload,
- anything at all about iOS: no macOS runner, no signing identity, no
  provisioning profile. The iOS `Info.plist` is only *parsed* for purpose
  strings and recorded as evidence — that is a manifest read, not a build.

The permission list captured in build evidence is a manifest read, not a runtime
observation. It records what the app *asks for*, not what it *uses*.

## This repo never deploys

`.github/workflows/deploy.yml` demonstrates the shape of a production deploy and
then refuses to perform one:

- triggered only by `workflow_dispatch` or a `v*` tag — never a branch push,
  never a pull request;
- `needs: [gates]`, where `gates` reuses `ci.yml` wholesale, so every gate above
  blocks it and cannot drift out of sync with CI;
- the `firebase deploy` step is guarded by `if: ${{ false }}` and never runs;
- no Firebase credential exists in this repository or its GitHub environment;
- the disabled step still shows the correct order — Firestore rules and indexes
  first, then Functions and Hosting — and `check-deploy-shape.mjs` fails the
  build if that order is reversed or the guard is removed without switching to
  `--dry-run`.

A fork that wants to deploy for real has a four-step checklist in the workflow
comments.

## Why Melos 6

Melos 7+ dropped `melos.yaml` in favour of configuration inside the workspace
root `pubspec.yaml`. This repo pins **Melos 6.3.2**, the last line that reads
`melos.yaml`, because `melos.yaml` is the detection signal the VCQA standards
resolver and the `flutter-firebase-app` charter are written against, and because
it matches the production repo this stack was modelled on.

That is a real limitation of the current standard, not a preference: a Melos 7+
workspace using pub workspaces would not be detected as `flutter-firebase-app`
today. It is written up in [`docs/vcqa-report.md`](docs/vcqa-report.md).

`melos` is both a global tool and a root `dev_dependency`: the global launcher
detects the local install and runs the pinned version, so CI and a laptop run
the same Melos.

## Provenance

Built for [vibecodeqa/vibecodeqa#43](https://github.com/vibecodeqa/vibecodeqa/issues/43).
The stack shape was derived from a private production Flutter + Firebase
workspace; no product code, naming, branding or configuration from it appears
here.

MIT licensed — see [`LICENSE`](LICENSE).
