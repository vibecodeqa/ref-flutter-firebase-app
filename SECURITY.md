# Security policy

This is a product-neutral reference repository. It holds no production data, no
Firebase credentials and no live project. Even so, the boundaries it draws are
the real ones, and this file states them explicitly so that neither a human nor
an automated scanner "fixes" the wrong side of the line.

## What is public on purpose

The Firebase **client** configuration is public by design, and this repository
commits it deliberately:

- API key (`FIREBASE_API_KEY`)
- App ID (`FIREBASE_APP_ID`, `FIREBASE_ADMIN_APP_ID`)
- Project ID (`FIREBASE_PROJECT_ID`)
- Messaging sender ID, auth domain, storage bucket

Every one of these values is compiled into the web bundle, the APK and the IPA
that any user can download and unpack. A Firebase API key identifies a project;
it is not a bearer credential and does not by itself grant read or write access
to anything. Access is decided by Firebase Auth, Firestore security rules,
Storage rules and App Check.

Moving these into a secret store buys no security and makes builds harder to
reproduce. **Do not report committed Firebase client config as a leak.** See
`packages/app/lib/firebase_options.dart` for the same explanation in-code.

Reference: <https://firebase.google.com/docs/projects/api-keys>

## What must never be committed

Everything on the trusted side of the boundary:

| Material | Why | Where it belongs |
|---|---|---|
| Service-account JSON (`"type": "service_account"`) | Bypasses all security rules via the Admin SDK | Workload Identity Federation, or a CI secret |
| Admin SDK private keys, any PEM `PRIVATE KEY` block | Full project impersonation | Secret manager |
| Firebase CI deploy tokens (`FIREBASE_TOKEN`) | Long-lived, deploy-capable, hard to scope | Prefer OIDC/WIF; otherwise a CI secret |
| Web Push (VAPID) private keys | Lets an attacker send push as your app | Secret manager |
| Android keystores (`.jks`, `.keystore`), `key.properties` | Lets an attacker ship a signed impostor build | CI secret / managed signing |
| Apple signing keys (`.p8`, `.p12`, `.mobileprovision`) | Same | CI secret / managed signing |
| `.runtimeconfig.json` | Contains Functions runtime secrets | `firebase functions:secrets` |
| `.env` files with real values | Everything above, eventually | Secret manager |

These are excluded by `.gitignore`, and — because a `.gitignore` entry can be
bypassed with `git add -f` and is therefore not evidence — they are additionally
enforced by two committed checks that run on every CI build:

- `scripts/check-no-secrets.mjs` scans every **git-tracked** file for
  credential-shaped content and credential-shaped filenames.
- `scripts/check-bundle-secrets.mjs` scans the **built web bundles** after
  `flutter build web`, because a source-clean repo can still ship a key that a
  `--dart-define` or a copied asset introduced at build time.

## Where privilege actually comes from

The admin console holds no key of any kind. Privilege comes from the `admin`
custom claim on the caller's Firebase ID token, and it is verified twice on the
server:

1. `firestore.rules` reads `request.auth.token.admin` for privileged **reads**.
2. The callable Cloud Function re-checks `request.auth.token.admin === true`
   before performing any Admin SDK **write**.

The client-side gate in `packages/admin/lib/admin_app.dart` only decides what to
render. Both server checks are covered by tests
(`firestore-tests/rules.test.mjs`, `packages/functions/src/policy.test.ts`),
including the case of a client presenting `admin: "true"` as a string.

Crucially, an admin **cannot** write the moderation fields directly, even with
the claim: `firestore.rules` forbids every client from writing `reviewState`,
`reviewedBy` and `reviewedAt`. The only path is the Cloud Function.

## Deployment

This repository never deploys. `.github/workflows/deploy.yml` is gated on manual
dispatch or a version tag, requires every CI gate to pass first, and its
`firebase deploy` step is disabled with `if: ${{ false }}`. No Firebase
credential is configured in this repository or in its GitHub environment.

## Reporting a vulnerability

This is a documentation and reference artifact with no users and no data. If you
find a flaw in the patterns it teaches, open an issue on
<https://github.com/vibecodeqa/vibecodeqa/issues>.
