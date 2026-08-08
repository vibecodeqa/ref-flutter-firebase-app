#!/usr/bin/env node
/**
 * Fails if anything server-side-secret shaped has been committed.
 *
 * The Firebase client config in this repo is public on purpose (see
 * `packages/app/lib/firebase_options.dart`). The point of this check is the
 * *other* side of that boundary: Admin SDK service accounts, private keys,
 * signing material, CI deploy tokens and runtime config dumps must never be
 * tracked by git — and a `.gitignore` entry alone is not evidence, because a
 * `git add -f` defeats it silently.
 *
 * Run: `npm run check:secrets`
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..');

/** Content patterns that indicate a real credential. */
const CONTENT_RULES = [
  { id: 'service-account-json', re: /"type"\s*:\s*"service_account"/, what: 'a Google service-account JSON' },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, what: 'a PEM private key' },
  { id: 'service-account-fields', re: /"private_key_id"\s*:\s*"[^"]+"/, what: 'service-account key material' },
  { id: 'adminsdk-identity', re: /firebase-adminsdk-[a-z0-9]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/, what: 'an Admin SDK service-account identity' },
  { id: 'firebase-ci-token', re: /FIREBASE_TOKEN\s*[:=]\s*["']?[A-Za-z0-9_\-./]{20,}/, what: 'a Firebase CI deploy token' },
  { id: 'gcp-oauth-secret', re: /"client_secret"\s*:\s*"[^"]{10,}"/, what: 'an OAuth client secret' },
  { id: 'vapid-private-key', re: /VAPID_PRIVATE_KEY\s*[:=]\s*["']?[A-Za-z0-9_\-]{30,}/, what: 'a Web Push (VAPID) private key' },
];

/** Path patterns that must never be tracked, whatever they contain. */
const PATH_RULES = [
  { id: 'service-account-file', re: /(^|\/)(service[-_]?account|serviceAccountKey)[^/]*\.json$/i, what: 'a service-account key file' },
  { id: 'adminsdk-file', re: /-firebase-adminsdk-[^/]*\.json$/i, what: 'an Admin SDK key file' },
  { id: 'runtime-config', re: /(^|\/)\.runtimeconfig\.json$/, what: 'a Functions runtime config dump' },
  { id: 'signing-material', re: /\.(jks|keystore|p12|p8|mobileprovision)$/i, what: 'signing material' },
  { id: 'android-key-properties', re: /(^|\/)key\.properties$/, what: 'Android signing properties' },
  { id: 'dotenv', re: /(^|\/)\.env(\.[a-z]+)?$/i, what: 'a dotenv file' },
  { id: 'firebase-debug-log', re: /(^|\/)(firebase|firestore|ui|database)-debug\.log$/, what: 'an emulator debug log' },
];

/**
 * Files that legitimately *name* these patterns: this checker, the security
 * documentation, and the tests that assert the patterns are absent.
 * Everything else is checked.
 */
const MENTION_ALLOWLIST = new Set([
  'scripts/check-no-secrets.mjs',
  'scripts/check-deploy-shape.mjs',
  'SECURITY.md',
  'README.md',
  '.gitignore',
  'docs/vcqa-report.md',
  'docs/build-evidence.md',
  'packages/admin/test/no_direct_write_test.dart',
  'packages/app/test/app_test.dart',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
]);

const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|ttf|otf|woff2?|zip|jar|so|dylib|dll|wasm|pdf)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

const failures = [];
const files = trackedFiles();

for (const file of files) {
  for (const rule of PATH_RULES) {
    if (rule.re.test(file)) {
      failures.push(`${file}: looks like ${rule.what} [${rule.id}]`);
    }
  }
}

for (const file of files) {
  if (MENTION_ALLOWLIST.has(file)) continue;
  if (BINARY.test(file)) continue;
  const abs = join(REPO_ROOT, file);
  let size = 0;
  try {
    size = statSync(abs).size;
  } catch {
    continue;
  }
  if (size > MAX_BYTES) continue;
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  for (const rule of CONTENT_RULES) {
    if (rule.re.test(text)) {
      failures.push(`${file}: contains what looks like ${rule.what} [${rule.id}]`);
    }
  }
}

if (failures.length > 0) {
  console.error('Committed-secret check FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\nPublic Firebase client config is fine and expected. Server credentials are not.\n' +
      'See SECURITY.md for what belongs in a secret store instead.',
  );
  process.exit(1);
}

console.log(
  `Committed-secret check passed: ${files.length} tracked files scanned, ` +
    `${CONTENT_RULES.length} content rules, ${PATH_RULES.length} path rules, ` +
    `${MENTION_ALLOWLIST.size} documentation files allowlisted for mentions.`,
);
