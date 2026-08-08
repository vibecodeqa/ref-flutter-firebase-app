#!/usr/bin/env node
/**
 * Negative evidence for the "client config is public, server secrets are not"
 * boundary — checked against the *built artifact*, not the source tree.
 *
 * Source-level checks can be satisfied while a `--dart-define`, a generated
 * file or a copied asset still drops a private key into the shipped bundle.
 * This runs over `build/web` after `flutter build web`, which is the thing a
 * user actually downloads.
 *
 * The Firebase API key, app id, project id and auth domain are expected to be
 * present. That is the point of the boundary: those are public.
 *
 * Usage: node scripts/check-bundle-secrets.mjs <dir> [<dir>...]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES = [
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, what: 'a PEM private key' },
  { id: 'service-account-json', re: /"type"\s*:\s*"service_account"/, what: 'a service-account JSON' },
  { id: 'service-account-key-id', re: /"private_key_id"\s*:/, what: 'service-account key material' },
  { id: 'adminsdk-identity', re: /firebase-adminsdk-[a-z0-9]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/, what: 'an Admin SDK identity' },
  { id: 'gcp-refresh-token', re: /"refresh_token"\s*:\s*"1\/\/[^"]+"/, what: 'a Google OAuth refresh token' },
  { id: 'vapid-private-key', re: /VAPID_PRIVATE_KEY/, what: 'a Web Push (VAPID) private key' },
];

const TEXTUAL = /\.(js|mjs|json|html|css|map|txt|wasm)$/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: check-bundle-secrets.mjs <build-dir> [<build-dir>...]');
  process.exit(2);
}

const failures = [];
let scanned = 0;

for (const dir of dirs) {
  let files;
  try {
    files = walk(dir);
  } catch {
    console.error(`Build directory not found: ${dir}`);
    process.exit(1);
  }
  for (const file of files) {
    if (!TEXTUAL.test(file)) continue;
    scanned++;
    const text = readFileSync(file, 'latin1');
    for (const rule of RULES) {
      if (rule.re.test(text)) {
        failures.push(`${file}: shipped bundle contains ${rule.what} [${rule.id}]`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Bundle secret check FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Bundle secret check passed: ${scanned} shipped files scanned across ${dirs.length} bundle(s); ` +
    'public Firebase client config only, no server credential material.',
);
