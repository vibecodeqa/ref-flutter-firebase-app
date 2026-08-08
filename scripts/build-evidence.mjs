#!/usr/bin/env node
/**
 * Records what a Flutter build actually was, so a reviewer does not have to
 * trust a screenshot.
 *
 * A "we built the app" line in a CI log proves almost nothing: it does not say
 * which Flutter version produced it, which Firebase project the artifact talks
 * to, which platform permissions the manifest requests, or whether the artifact
 * that got uploaded is the one that got built. This script writes all of that
 * to a JSON file that CI uploads next to the artifact.
 *
 * Usage:
 *   node scripts/build-evidence.mjs \
 *     --target web-app \
 *     --artifact packages/app/build/web \
 *     --define FIREBASE_ENV=staging --define FIREBASE_PROJECT_ID=... \
 *     [--android-manifest packages/app/android/app/src/main/AndroidManifest.xml] \
 *     [--ios-plist packages/app/ios/Runner/Info.plist]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..');

function parseArgs(argv) {
  const args = { defines: {} };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--target') { args.target = value; i++; }
    else if (flag === '--artifact') { args.artifact = value; i++; }
    else if (flag === '--android-manifest') { args.androidManifest = value; i++; }
    else if (flag === '--ios-plist') { args.iosPlist = value; i++; }
    else if (flag === '--define') {
      const eq = value.indexOf('=');
      args.defines[value.slice(0, eq)] = value.slice(eq + 1);
      i++;
    }
  }
  if (!args.target || !args.artifact) {
    console.error('usage: build-evidence.mjs --target <name> --artifact <path> [--define K=V]...');
    process.exit(2);
  }
  return args;
}

function sh(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push({ path: full, size: st.size });
  }
  return out;
}

/** Android permissions are a user-visible promise; record what was requested. */
function androidPermissions(manifestPath) {
  if (!manifestPath || !existsSync(join(REPO_ROOT, manifestPath))) return null;
  const xml = readFileSync(join(REPO_ROOT, manifestPath), 'utf8');
  const permissions = [...xml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map(
    (m) => m[1],
  );
  const features = [...xml.matchAll(/<uses-feature[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  const cleartext = /android:usesCleartextTraffic="true"/.test(xml);
  return { manifest: manifestPath, permissions, features, usesCleartextTraffic: cleartext };
}

/** iOS purpose strings are the equivalent promise on Apple platforms. */
function iosUsageDescriptions(plistPath) {
  if (!plistPath || !existsSync(join(REPO_ROOT, plistPath))) return null;
  const plist = readFileSync(join(REPO_ROOT, plistPath), 'utf8');
  const keys = [...plist.matchAll(/<key>(NS[A-Za-z]*UsageDescription)<\/key>/g)].map((m) => m[1]);
  const allowsArbitraryLoads = /<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/.test(plist);
  return { plist: plistPath, usageDescriptionKeys: keys, allowsArbitraryLoads };
}

const args = parseArgs(process.argv.slice(2));
const artifactDir = join(REPO_ROOT, args.artifact);

if (!existsSync(artifactDir)) {
  console.error(`Artifact path does not exist: ${args.artifact}`);
  process.exit(1);
}

const stat = statSync(artifactDir);
const files = stat.isDirectory()
  ? walk(artifactDir)
  : [{ path: artifactDir, size: stat.size }];

const hashed = files
  .map((file) => ({
    path: relative(REPO_ROOT, file.path),
    bytes: file.size,
    sha256: createHash('sha256').update(readFileSync(file.path)).digest('hex'),
  }))
  .sort((a, b) => b.bytes - a.bytes);

let flutter = null;
const machine = sh('flutter', ['--version', '--machine']);
if (machine) {
  try {
    const parsed = JSON.parse(machine);
    flutter = {
      frameworkVersion: parsed.frameworkVersion,
      channel: parsed.channel,
      frameworkRevision: parsed.frameworkRevision,
      engineRevision: parsed.engineRevision,
      dartSdkVersion: parsed.dartSdkVersion,
    };
  } catch {
    flutter = { raw: machine };
  }
}

const evidence = {
  target: args.target,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? sh('git', ['rev-parse', 'HEAD']),
  ref: process.env.GITHUB_REF ?? sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
  workflowRunUrl:
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
  flutter,
  // The environment defines decide which Firebase project the artifact talks to.
  // Recording them is the difference between "a build" and "a promotable build".
  environmentDefines: args.defines,
  artifact: {
    path: args.artifact,
    fileCount: hashed.length,
    totalBytes: hashed.reduce((sum, f) => sum + f.bytes, 0),
    files: hashed.slice(0, 25),
  },
  android: androidPermissions(args.androidManifest),
  ios: iosUsageDescriptions(args.iosPlist),
};

const outDir = join(REPO_ROOT, 'build-evidence');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${args.target}.json`);
writeFileSync(outFile, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(`Build evidence written to build-evidence/${args.target}.json`);
console.log(`  flutter:      ${flutter?.frameworkVersion ?? 'unknown'} (${flutter?.channel ?? '?'})`);
console.log(`  commit:       ${evidence.commit}`);
console.log(`  defines:      ${Object.keys(args.defines).join(', ') || '(none)'}`);
console.log(`  artifact:     ${hashed.length} files, ${evidence.artifact.totalBytes} bytes`);
if (evidence.android) {
  console.log(`  android perms: ${evidence.android.permissions.join(', ') || '(none declared)'}`);
}
if (evidence.ios) {
  console.log(`  ios purposes:  ${evidence.ios.usageDescriptionKeys.join(', ') || '(none declared)'}`);
}
