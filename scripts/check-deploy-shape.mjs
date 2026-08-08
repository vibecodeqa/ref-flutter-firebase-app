#!/usr/bin/env node
/**
 * Asserts the deploy path is gated, credential-free and correctly ordered.
 *
 * A Flutter + Firebase repo can fail its release discipline in ways that are
 * invisible in a green CI badge: a deploy that fires on every push, a gate job
 * marked `continue-on-error`, a Firestore rules deploy that lands after the code
 * that depends on it, a long-lived deploy token pasted into a workflow. This
 * check makes each of those a build failure.
 *
 * Run: `npm run check:deploy-shape`
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

const REPO_ROOT = join(import.meta.dirname, '..');
const readText = (p) => readFileSync(join(REPO_ROOT, p), 'utf8');
const readYaml = (p) => parse(readText(p));
const readJson = (p) => JSON.parse(readText(p));

const failures = [];
const fail = (msg) => failures.push(msg);

// ── firebase.json: the deployable surface is fully declared ──
const firebase = readJson('firebase.json');

if (!firebase.firestore?.rules) fail('firebase.json: firestore.rules is not declared');
if (!firebase.firestore?.indexes) fail('firebase.json: firestore.indexes is not declared');

const functions = Array.isArray(firebase.functions) ? firebase.functions : [firebase.functions];
if (!functions[0]?.source) fail('firebase.json: no functions source is declared');
if (functions[0]?.runtime !== 'nodejs22') {
  fail(`firebase.json: functions runtime should be nodejs22, found ${functions[0]?.runtime}`);
}
const predeploy = (functions[0]?.predeploy ?? []).join(' ');
for (const gate of ['typecheck', 'test', 'build']) {
  if (!predeploy.includes(gate)) {
    fail(`firebase.json: functions predeploy does not run "${gate}"`);
  }
}

const hosting = Array.isArray(firebase.hosting) ? firebase.hosting : [firebase.hosting];
const hostingTargets = hosting.map((h) => h?.target).filter(Boolean);
for (const target of ['app', 'admin']) {
  if (!hostingTargets.includes(target)) {
    fail(`firebase.json: no hosting target named "${target}"`);
  }
}

// ── emulator ports are pinned, so CI, local dev and rules tests agree ──
const emulators = firebase.emulators ?? {};
for (const service of ['auth', 'firestore', 'functions', 'hosting']) {
  if (typeof emulators[service]?.port !== 'number') {
    fail(`firebase.json: emulators.${service}.port is not pinned to an explicit number`);
  }
}

// ── .firebaserc: environments are separate and named ──
const firebaserc = readJson('.firebaserc');
const projects = firebaserc.projects ?? {};
for (const alias of ['dev', 'staging', 'prod']) {
  if (!projects[alias]) fail(`.firebaserc: no "${alias}" project alias`);
}
const distinct = new Set([projects.dev, projects.staging, projects.prod].filter(Boolean));
if (distinct.size < 3) {
  fail('.firebaserc: dev, staging and prod must point at three distinct Firebase projects');
}
if (projects.dev && !String(projects.dev).startsWith('demo-')) {
  fail('.firebaserc: the dev alias should use a "demo-" project id so the emulator stays offline');
}

// ── ci.yml: no required gate is allowed to be non-blocking ──
const ciText = readText('.github/workflows/ci.yml');
const ci = readYaml('.github/workflows/ci.yml');
const ciJobs = Object.entries(ci.jobs ?? {});
if (ciJobs.length === 0) fail('.github/workflows/ci.yml: no jobs');

const REQUIRED_CI_JOBS = [
  'static-checks',
  'flutter-workspace',
  'functions',
  'firestore-rules',
  'web-build',
  'android-build-shape',
];
for (const job of REQUIRED_CI_JOBS) {
  if (!(job in (ci.jobs ?? {}))) fail(`.github/workflows/ci.yml: required job "${job}" is missing`);
}

for (const [name, job] of ciJobs) {
  const nonBlocking = name.startsWith('report-');
  if (job['continue-on-error'] && !nonBlocking) {
    fail(`ci.yml job "${name}": continue-on-error is only allowed on report-* jobs`);
  }
  for (const step of job.steps ?? []) {
    if (step['continue-on-error'] && !nonBlocking) {
      fail(`ci.yml job "${name}": step "${step.name ?? step.uses}" is continue-on-error`);
    }
  }
  if (typeof job['timeout-minutes'] !== 'number' || job['timeout-minutes'] < 30) {
    fail(`ci.yml job "${name}": needs an explicit timeout-minutes of at least 30`);
  }
}

// Third-party actions must be pinned by commit SHA, not by a movable tag.
for (const match of ciText.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)) {
  const [, action, ref] = match;
  if (action.startsWith('./')) continue;
  if (!/^[0-9a-f]{40}$/.test(ref)) {
    fail(`ci.yml: action ${action} is pinned to "${ref}" instead of a 40-hex commit SHA`);
  }
}

// ── deploy.yml: deliberate triggers, full gating, no live deploy ──
const deployText = readText('.github/workflows/deploy.yml');
const deploy = readYaml('.github/workflows/deploy.yml');
const on = deploy.on ?? deploy.true; // YAML 1.1 parsers can fold `on:` to true

if (!on || typeof on !== 'object') {
  fail('deploy.yml: triggers must be declared explicitly');
} else {
  if ('pull_request' in on) fail('deploy.yml: must never be triggered by pull_request');
  if (on.push && on.push.branches) {
    fail('deploy.yml: must never be triggered by a branch push; use tags or manual dispatch');
  }
  if (!('workflow_dispatch' in on) && !on.push?.tags) {
    fail('deploy.yml: must be gated on workflow_dispatch and/or a version tag');
  }
}

const deployJob = deploy.jobs?.deploy;
if (!deployJob) {
  fail('deploy.yml: no "deploy" job');
} else {
  const needs = Array.isArray(deployJob.needs) ? deployJob.needs : [deployJob.needs].filter(Boolean);
  if (!needs.includes('gates')) {
    fail('deploy.yml: the deploy job must "needs: [gates]" so every CI gate blocks it');
  }
  if (deployJob['continue-on-error']) {
    fail('deploy.yml: the deploy job must not be continue-on-error');
  }
}

const gatesJob = deploy.jobs?.gates;
if (!gatesJob) {
  fail('deploy.yml: no "gates" job');
} else if (gatesJob.uses !== './.github/workflows/ci.yml') {
  fail('deploy.yml: the gates job must reuse ./.github/workflows/ci.yml rather than re-declaring gates');
}

// The deploy step must be inert in this repository.
const deploySteps = deployJob?.steps ?? [];
const liveDeploySteps = deploySteps.filter(
  (step) => typeof step.run === 'string' && /firebase\s+deploy/.test(step.run),
);
if (liveDeploySteps.length === 0) {
  fail('deploy.yml: expected a (disabled) firebase deploy step to document the deploy shape');
}
for (const step of liveDeploySteps) {
  const guard = String(step.if ?? '');
  const disabled = /\$\{\{\s*false\s*\}\}/.test(guard) || guard.trim() === 'false';
  const dryRun = /--dry-run/.test(step.run);
  if (!disabled && !dryRun) {
    fail(
      `deploy.yml: step "${step.name ?? '(unnamed)'}" runs a real firebase deploy. ` +
        'This reference repository must never deploy: disable it with `if: ${{ false }}` or use --dry-run.',
    );
  }
  // Rules must be promoted before the code that depends on them.
  const rulesAt = step.run.indexOf('firestore:rules');
  const hostingAt = step.run.indexOf('hosting');
  if (rulesAt >= 0 && hostingAt >= 0 && rulesAt > hostingAt) {
    fail('deploy.yml: Firestore rules must be deployed before hosting/functions');
  }
}

// ── no credential material anywhere in the workflows ──
for (const [file, text] of [
  ['.github/workflows/ci.yml', ciText],
  ['.github/workflows/deploy.yml', deployText],
]) {
  if (/FIREBASE_TOKEN\s*:\s*["']?[A-Za-z0-9_\-./]{20,}/.test(text)) {
    fail(`${file}: a Firebase deploy token literal is present`);
  }
  if (/"type"\s*:\s*"service_account"/.test(text)) {
    fail(`${file}: a service-account JSON literal is present`);
  }
  const permissions = (file.endsWith('ci.yml') ? ci : deploy).permissions;
  if (permissions === undefined) {
    fail(`${file}: declare an explicit least-privilege \`permissions:\` block`);
  } else if (permissions !== 'read-all' && permissions?.contents !== 'read') {
    fail(`${file}: top-level permissions should be contents: read`);
  }
}

if (failures.length > 0) {
  console.error('Deploy-shape check FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  'Deploy-shape check passed: firebase.json fully declared, three separate environments, ' +
    `${REQUIRED_CI_JOBS.length} required blocking CI gates, actions pinned by SHA, ` +
    'deploy gated on those gates, and the deploy step is disabled with no credentials present.',
);
