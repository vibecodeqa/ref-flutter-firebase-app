#!/usr/bin/env node
/**
 * Treats `firestore.indexes.json` as a deployable artifact with a contract.
 *
 * The Firestore emulator does not enforce composite indexes, so an emulator-green
 * test suite proves nothing about whether a production query will run. This check
 * closes that gap the only way a repo can without a live project: every composite
 * query is declared in `firestore.queries.json`, and this script proves that
 *
 *   1. each declared query has an exactly matching index,
 *   2. each declared query's source file still exists and still mentions the
 *      collection and every field the declaration claims, and
 *   3. no index is shipped that no declared query needs.
 *
 * What it does NOT do: discover queries automatically. A new composite query that
 * nobody declares here will not be caught. That limitation is recorded in
 * `docs/vcqa-report.md`.
 *
 * Run: `npm run check:indexes`
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..');
const read = (name) => JSON.parse(readFileSync(join(REPO_ROOT, name), 'utf8'));

const indexes = read('firestore.indexes.json');
const queries = read('firestore.queries.json');

const failures = [];
const ORDERS = new Set(['ASCENDING', 'DESCENDING']);
const SCOPES = new Set(['COLLECTION', 'COLLECTION_GROUP']);

// ── 1. structural validity of the deployable artifact ──
if (!Array.isArray(indexes.indexes)) {
  failures.push('firestore.indexes.json: "indexes" must be an array');
}
if (!Array.isArray(indexes.fieldOverrides)) {
  failures.push('firestore.indexes.json: "fieldOverrides" must be an array (use [] if none)');
}

for (const [i, index] of (indexes.indexes ?? []).entries()) {
  const at = `firestore.indexes.json indexes[${i}]`;
  if (typeof index.collectionGroup !== 'string' || index.collectionGroup.length === 0) {
    failures.push(`${at}: missing collectionGroup`);
  }
  if (!SCOPES.has(index.queryScope)) {
    failures.push(`${at}: queryScope must be one of ${[...SCOPES].join(', ')}`);
  }
  if (!Array.isArray(index.fields) || index.fields.length < 2) {
    failures.push(`${at}: a composite index needs at least two fields`);
    continue;
  }
  for (const [j, field] of index.fields.entries()) {
    if (typeof field.fieldPath !== 'string') {
      failures.push(`${at}.fields[${j}]: missing fieldPath`);
    }
    if (field.order !== undefined && !ORDERS.has(field.order)) {
      failures.push(`${at}.fields[${j}]: order must be ASCENDING or DESCENDING`);
    }
    if (field.order === undefined && field.arrayConfig === undefined) {
      failures.push(`${at}.fields[${j}]: needs either order or arrayConfig`);
    }
  }
}

// ── 2. every declared query is backed by an index ──
const signature = (collectionGroup, queryScope, fields) =>
  `${collectionGroup}|${queryScope}|${fields
    .map((f) => `${f.fieldPath}:${f.order ?? f.arrayConfig}`)
    .join(',')}`;

const indexSignatures = new Map();
for (const index of indexes.indexes ?? []) {
  indexSignatures.set(signature(index.collectionGroup, index.queryScope, index.fields ?? []), index);
}

const usedSignatures = new Set();
const seenIds = new Set();

for (const [i, query] of (queries.queries ?? []).entries()) {
  const at = `firestore.queries.json queries[${i}]`;
  if (typeof query.id !== 'string' || query.id.length === 0) {
    failures.push(`${at}: missing id`);
    continue;
  }
  if (seenIds.has(query.id)) failures.push(`${at}: duplicate id "${query.id}"`);
  seenIds.add(query.id);

  if (typeof query.description !== 'string' || query.description.length < 10) {
    failures.push(`${at} (${query.id}): needs a human description`);
  }

  const sig = signature(query.collectionGroup, query.queryScope, query.fields ?? []);
  if (!indexSignatures.has(sig)) {
    failures.push(
      `${at} (${query.id}): no index in firestore.indexes.json matches ` +
        `${query.collectionGroup} [${(query.fields ?? [])
          .map((f) => `${f.fieldPath} ${f.order}`)
          .join(', ')}]`,
    );
  } else {
    usedSignatures.add(sig);
  }

  // ── 3. the declaration still matches the source that issues the query ──
  if (typeof query.source !== 'string' || !existsSync(join(REPO_ROOT, query.source))) {
    failures.push(`${at} (${query.id}): source "${query.source}" does not exist`);
    continue;
  }
  const source = readFileSync(join(REPO_ROOT, query.source), 'utf8');
  if (!source.includes(query.collectionGroup)) {
    failures.push(
      `${at} (${query.id}): ${query.source} no longer mentions collection "${query.collectionGroup}"`,
    );
  }
  for (const field of query.fields ?? []) {
    if (!source.includes(field.fieldPath)) {
      failures.push(
        `${at} (${query.id}): ${query.source} no longer mentions field "${field.fieldPath}"`,
      );
    }
  }
}

// ── 4. no unexplained indexes ──
for (const [sig] of indexSignatures) {
  if (!usedSignatures.has(sig)) {
    failures.push(
      `firestore.indexes.json: index ${sig} is not required by any query declared in ` +
        'firestore.queries.json. Declare the query or drop the index.',
    );
  }
}

if (failures.length > 0) {
  console.error('Firestore index check FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Firestore index check passed: ${(queries.queries ?? []).length} declared composite ` +
    `queries, ${(indexes.indexes ?? []).length} indexes, all matched.`,
);
