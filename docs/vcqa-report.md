# VCQA Report

Score: **93/100 — grade A**

| | |
|---|---|
| Scanner | `@vibecodeqa/cli@0.54.4` (`npx @vibecodeqa/cli@0.54.4 --markdown`) |
| Run date | 2026-08-09 |
| Assessed commit | [`ec7cd52348af20db7e03bd28b25025a5bf579784`](https://github.com/vibecodeqa/ref-flutter-firebase-app/commit/ec7cd52348af20db7e03bd28b25025a5bf579784) |
| CI run | [Actions run 31281954465](https://github.com/vibecodeqa/ref-flutter-firebase-app/actions/runs/31281954465) — **success**, 2026-08-08 UTC |
| Detected stack | `dart · monorepo (melos)` |
| Assessor | automated scan + hand verification; no independent third-party assessment |

## Standards this repo is measured against

The primary standard for this repo, `flutter-firebase-app`, is **a charter, not
yet a versioned rubric**. It has no `standardUrl`; `standards/registry.json`
records it as `status: planned`, `maturity: draft-charter`. Its eight candidate
rules name a behaviour but none of them yet states a severity, required evidence
or accepted exception, so nothing judgeable can be cut from them.

- **Primary (charter, not a rubric):**
  <https://vibecodeqa.online/docs/standards/stacks/flutter-firebase-app/>
- Published rubrics that do apply, and that this repo was built against:
  - Testing v1 — <https://vibecodeqa.online/standards/testing/v1/>
  - Security v1 — <https://vibecodeqa.online/standards/security/v1/>
- Cross-cutting, also planned: Dependency Hygiene —
  <https://vibecodeqa.online/docs/standards/items/dependencies/>

Publishing `flutter-firebase-app` v1 at a stable
`/standards/flutter-firebase-app/v1/` URL is the other half of
[vibecodeqa/vibecodeqa#43](https://github.com/vibecodeqa/vibecodeqa/issues/43)
and has **not** landed. Until it does, this report cites a charter for its
primary standard, which is weaker evidence than every other `ref-*` repo in the
catalog can offer, and it should be re-run and re-cited against the v1 rubric
once that rubric exists.

## Resolver detection

`node standards/resolve.mjs <this repo>` resolves four slices:

```
  # packages/admin  [package]      cross-cutting: security@v1, testing@v1
  # packages/app    [package]      cross-cutting: security@v1, testing@v1
  # packages/functions [package]   archetype: typescript-sdk [PLANNED]
                                   cross-cutting: typescript@v1, security@v1,
                                                  testing@v1, dependencies [PLANNED]
  # packages/shared [package]      cross-cutting: security@v1, testing@v1
  Repo recipes: flutter-firebase-app [PLANNED]
```

That is the intended result: `flutter-firebase-app` plus `testing`, `security`
and `dependencies`. Two honest caveats are recorded under "Material findings".

## Category scores

| Category | Score | Weight |
|---|---|---|
| Foundations | 96 | 23 |
| Quality | 96 | 20 |
| Testing | 71 | 13 |
| Security | 99 | 16 |
| Architecture | 96 | 9 |
| LLM Readiness | 100 | 9 |

23 of 38 checks ran. Zero errors; 30 warnings/infos, discussed below.

## Evidence

Everything below is a required, blocking CI gate. None uses `continue-on-error`;
`scripts/check-deploy-shape.mjs` fails the build if one ever does.

| Claim | Evidence |
|---|---|
| Workspace is orchestrated and reproducible | [`melos.yaml`](../melos.yaml), [`ci.yml` job `flutter-workspace`](../.github/workflows/ci.yml) — `melos bootstrap`, `flutter analyze --fatal-infos`, `dart format` check, and app/admin/shared tests as three separately named steps |
| Firestore rules are enforced and tested | [`firestore.rules`](../firestore.rules), [`firestore-tests/rules.test.mjs`](../firestore-tests/rules.test.mjs) — 32 tests against the Firestore emulator (`firebase emulators:exec`, JDK 21 installed explicitly) |
| A non-owner cannot read a private note | `firestore-tests/rules.test.mjs` → "denies a non-owner reading a private note" |
| No client can write a Function-owned field | `firestore-tests/rules.test.mjs` → "DENIES an owner writing the Function-owned reviewState field" and "DENIES an admin-claim client writing reviewState directly" |
| Trusted mutations live server-side | [`packages/functions/src/index.ts`](../packages/functions/src/index.ts), [`policy.ts`](../packages/functions/src/policy.ts), 24 unit tests at 100% statement / 97.5% branch coverage of the policy module |
| The admin console never writes directly | [`packages/admin/test/no_direct_write_test.dart`](../packages/admin/test/no_direct_write_test.dart) — a structural test that fails on any `.set(`/`.update(`/`.add(`/`.delete(` in the admin package |
| Three runtimes agree on the server-owned field list | Dart: `packages/shared/test/access_policy_test.dart`; TypeScript: `packages/functions/src/policy.test.ts` (both parse `firestore.rules`) |
| Client config is public, server secrets are not | [`SECURITY.md`](../SECURITY.md), [`scripts/check-no-secrets.mjs`](../scripts/check-no-secrets.mjs) (139 tracked files, 7 content + 7 path rules), [`scripts/check-bundle-secrets.mjs`](../scripts/check-bundle-secrets.mjs) (38 shipped files across both built web bundles) |
| Environments are separated | [`.firebaserc`](../.firebaserc) — three distinct aliases; `--dart-define` drives `firebase_options.dart`; `check-deploy-shape.mjs` fails if the three aliases ever collapse |
| Indexes are a tested deployable artifact | [`firestore.indexes.json`](../firestore.indexes.json), [`firestore.queries.json`](../firestore.queries.json), [`scripts/check-firestore-indexes.mjs`](../scripts/check-firestore-indexes.mjs) |
| Builds carry evidence | [`scripts/build-evidence.mjs`](../scripts/build-evidence.mjs), [`docs/build-evidence.md`](build-evidence.md); uploaded as CI artifacts |
| Deploy is gated and inert | [`deploy.yml`](../.github/workflows/deploy.yml), [`scripts/check-deploy-shape.mjs`](../scripts/check-deploy-shape.mjs) |

## Material findings

### 1. The scanner runs 24 of this repo's 96 tests

This is the finding that matters most for interpreting the 93.

`@vibecodeqa/cli` is JS/TS-centric. It discovered and executed exactly one test
runner — Vitest in `packages/functions` — and reported `24 passed`. It did not
execute the 40 Flutter/Dart tests (`flutter test`, three packages) or the 32
Firestore rules tests (which need the emulator). So the Testing category's
71/100, its `pairing: 8%` and its `assertionsPerTest: 1.3` are computed from a
file inventory that counts Dart sources but cannot run or parse Dart tests.

The real picture, verified by hand and by CI on this commit:

| Suite | Tests | Runner |
|---|---|---|
| `packages/shared` | 19 | `flutter test` |
| `packages/app` | 9 | `flutter test` |
| `packages/admin` | 12 | `flutter test` |
| `packages/functions` | 24 | `vitest run --coverage` |
| `firestore-tests` | 32 | `vitest` inside `firebase emulators:exec` |
| **Total** | **96** | |

**This is not a repo defect; it is a scanner/stack mismatch, and it is worth
recording as one.** A `flutter-firebase-app` rubric cannot rely on the generic
scanner's Testing score. It has to require named, separately-visible CI gates
per package — which is why `ci.yml` runs `test:shared`, `test:app` and
`test:admin` as three distinct steps rather than one `melos run test`.

### 2. 25 of the 30 remaining warnings are a JavaScript lint applied to Dart

The `standards` check scores 70/100 on 25 "code smells", every one of which is
`Use === instead of ==`, reported against `.dart` files:

```
packages/shared/lib/src/access_policy.dart:49  Use === instead of ==
packages/shared/lib/src/admin_claims.dart:22   Use === instead of ==
packages/app/lib/firebase_options.dart:38      Use === instead of ==
...
```

Dart has no `===`. `==` is the correct and only operator. Acting on this advice
would not compile. Nothing was changed in response to it, and the `standards`
score of 70 should be read as *not applicable* for this stack rather than as a
real deficit. This is the single largest scanner artefact in the score.

### 3. The resolver classifies the Cloud Functions package as a `typescript-sdk`

`packages/functions` matches the `typescript-sdk` archetype because its
`package.json` declares `main` — which a Firebase Functions package must, since
that is how the runtime finds the entry point. It is not an SDK: it publishes
nothing and is deployed, not imported.

Recommendation for the resolver: exclude a package from `typescript-sdk` when a
sibling or ancestor `firebase.json` names it as a `functions.source`.

### 4. A Melos 7+ workspace would not be detected at all

The `flutter-firebase-app` detect predicate requires a `melos.yaml`. Melos 7
dropped `melos.yaml` in favour of a `melos:` key inside the workspace root
`pubspec.yaml` (with pub workspaces). This repo therefore pins **Melos 6.3.2**,
the last version that reads `melos.yaml` — deliberately, and documented in the
README — so that it is detectable by the standard it is meant to demonstrate.

That is backwards: a reference implementation should not have to hold an old
tool to be recognised. The detect predicate should also accept a root
`pubspec.yaml` containing a `melos:` key or a `workspace:` list. Until it does,
the standard silently under-detects the newest workspaces in this stack.

### 5. Dead-code analysis needs to be told where a Firebase entry point is

Knip initially reported `packages/functions/src/index.ts` as an unused file: it
is loaded by the Cloud Functions runtime, not by any import in the repository.
[`knip.json`](../knip.json) now declares it, along with `scripts/*.mjs` and the
rules-test harness. Worth noting because *every* repo in this stack will hit it.

### 6. Smaller, real, and accepted

- **`dynamic` in `packages/app/lib/note_service.dart:27`** —
  `CollectionReference<Map<String, dynamic>>` is `cloud_firestore`'s own return
  type. Not fixable without wrapping the SDK; accepted.
- **Duplicate 25-line block across the two `firebase_options.dart` files** —
  deliberate. The end-user app and the admin console are separate Firebase apps
  in the same project, deployed and versioned separately; sharing the class
  would couple two independently releasable clients to one another. Called out
  here so a reviewer sees the choice rather than the diff.
- **`firebase` is a ~200 KB dependency** — it is a devDependency of the rules
  test harness only, and never enters a shipped bundle.
- **One dependency is a major version behind** — `@firebase/rules-unit-testing`
  tracks the Firebase JS SDK release train; the pinned major is the one
  compatible with the emulator suite used here.
- **No `integration_test/` in either Flutter package** — see residual risks.

## Remaining standard gaps

- `flutter-firebase-app` has no v1 rubric and no `standardUrl`. This report
  cites a charter for its primary standard.
- `dependencies` (Dependency Hygiene) is also `planned` with no rubric, though
  this repo pins a lockfile per Node package, pins the Flutter and Melos
  versions, and pins every third-party GitHub Action by 40-hex commit SHA.
- No `accessibility` rubric was resolved: the scanner skipped the accessibility
  check because it found no framework components it recognises. A Flutter web
  app has real accessibility obligations that neither the scanner nor the
  charter currently covers.

## Residual risks — why this is not 100

1. **Nothing here has ever been deployed.** `.firebaserc` carries placeholder
   staging and production project ids, and the deploy step is disabled with
   `if: ${{ false }}`. There is no live Hosting release, no smoke check, no
   deployed rules version, and no evidence that the rules that pass in the
   emulator behave identically in a real project. A production fork must add
   protected GitHub Environments, Workload Identity Federation instead of a
   long-lived token, and post-deploy verification.
2. **The Android check is a debug compile, not a release build.** It proves the
   toolchain, Gradle configuration, manifest merge and plugin registration. It
   proves nothing about release signing, R8 shrinking, App Bundle packaging or
   store upload, because this repository holds no keystore by design.
3. **iOS is never built.** The `Info.plist` is parsed for purpose strings and
   recorded as evidence. That is a manifest read, not a build. A real fork needs
   a macOS runner, a signing identity and a provisioning profile.
4. **Index coverage is declaration-based.** `scripts/check-firestore-indexes.mjs`
   proves every query declared in `firestore.queries.json` has a matching index
   and that no index is unused — but it does not *discover* queries. A new
   composite query that nobody declares would not be caught, and the Firestore
   emulator does not enforce indexes, so the rules suite would not catch it
   either. Automatic query extraction from Dart and TypeScript sources is the
   obvious next step.
5. **`packages/functions/src/index.ts` is not unit-tested.** Importing it calls
   `initializeApp()` and `getFirestore()` at module load. It is deliberately
   kept to thin glue — claim check, payload parse, patch build, error mapping —
   and every decision it delegates to lives in `policy.ts`, which is at 100%
   statement coverage. The correct fix is a functions-emulator integration test
   that calls the callable end to end; that is not present.
6. **No end-to-end or integration tests.** There is no test that drives a
   Flutter client against the emulator suite and observes a moderation round
   trip through the callable Function. Each side of that seam is tested; the
   seam itself is not.
7. **The cross-runtime field-list tests are textual.** They parse
   `firestore.rules` with a regular expression. A rules file that expressed the
   same list differently would fail the test even while being correct, and a
   sufficiently creative refactor could satisfy the regex while changing
   behaviour. Generating all three from one source would be stronger.
8. **No dependency update automation.** Dependabot/Renovate are deliberately not
   enabled: this repository is trunk-based with no pull-request flow, so bot PRs
   would have nowhere to go. That means dependency freshness here is manual, and
   a real product fork should enable one of them.
9. **No `CONTRIBUTING.md`, `CODEOWNERS` or pre-commit hooks.** Flagged by the
   scanner's best-practices check and accepted: this is a reference artifact
   with a single maintainer and no external contribution flow. A product repo
   should not accept the same finding.
