# Build evidence

A green "build succeeded" line proves that something compiled. It does not say
*what* compiled, with which toolchain, against which Firebase project, or
whether the artifact that was uploaded is the artifact that was built. For a
Flutter + Firebase app those questions matter more than usual, because the same
source tree can be built against three different backends and can request
wildly different platform permissions without any code change being obvious in
review.

`scripts/build-evidence.mjs` runs after every build in CI and writes a JSON
record to `build-evidence/<target>.json`, uploaded as a workflow artifact.

## What is recorded

| Field | Why it is evidence |
|---|---|
| `flutter.frameworkVersion`, `channel`, `frameworkRevision`, `engineRevision`, `dartSdkVersion` | Reproducibility. A build from a different channel is a different artifact. Taken from `flutter --version --machine`, not from a workflow input, so it reflects what actually ran. |
| `commit`, `ref`, `workflowRunUrl` | Ties the artifact to a reviewable commit and a rerunnable CI job. |
| `environmentDefines` | **Which Firebase project this artifact talks to.** The single most important field: it is the difference between a debug build and one that can write production data. |
| `artifact.files[].sha256`, `bytes`, `fileCount` | Identity of the shipped bytes. Lets a reviewer confirm the uploaded artifact is the built one. |
| `android.permissions`, `android.features`, `android.usesCleartextTraffic` | The user-facing promise the app makes on Android, parsed from the merged-source manifest. A new permission shows up as a diff in evidence, not just in a manifest nobody reads. |
| `ios.usageDescriptionKeys`, `ios.allowsArbitraryLoads` | The same promise on Apple platforms. |

## Which builds produce evidence

| Target | Job | Artifact |
|---|---|---|
| `web-app` | `web-build` | `packages/app/build/web` |
| `web-admin` | `web-build` | `packages/admin/build/web` |
| `android-debug` | `android-build-shape` | `packages/app/build/app/outputs/flutter-apk/app-debug.apk` |

## Limits of this evidence — read before trusting it

- **The Android permission list is a manifest read, not a runtime observation.**
  It records what the app declares, not what it exercises. An app can declare
  `INTERNET` and never use it, or use a plugin that merges in a permission from
  its own manifest at a later Gradle stage than the one parsed here.
- **The iOS record is a plist parse.** No iOS build happens in this repository:
  that needs a macOS runner, a signing identity and a provisioning profile.
  Recording the purpose strings is useful, but it is not a build.
- **The Android build is a debug compile.** Release signing, R8 shrinking,
  App Bundle packaging and store upload are all unproven here, deliberately:
  this repository holds no keystore. See `SECURITY.md`.
- **No deployment evidence exists at all**, because this repository never
  deploys. A real fork should extend this file with the deployed URL, the
  Hosting release id and a post-deploy smoke check.
- `environmentDefines` records the defines *passed to the evidence script*. CI
  passes the same list it passed to `flutter build`; a fork that changes one
  without the other would record a lie. Keeping the two in one workflow step is
  the mitigation.
