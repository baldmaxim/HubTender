#!/usr/bin/env node
// scripts/app-auth/01_apply_app_auth_schema.mjs
//
// Apply the Phase 6 app-auth DB layer to Yandex Managed PostgreSQL.
//
// Source SQL: db/yandex/incremental/2026_05_app_auth_runtime.sql
// Report    : docs/yandex-migration/30_APP_AUTH_SCHEMA_APPLY_RESULT.md
//
// Flags:
//   --dry-run   Parse + forbidden-pattern scan + summary. NO DB connection,
//               NO writes. Always allowed.
//
// Env (from scripts/app-auth/.env.app-auth):
//   YANDEX_DATABASE_URL              Required for real apply (not for dry-run).
//   ALLOW_APPLY_APP_AUTH_SCHEMA      Must be literal "true" for real apply.
//
// Safety:
//   * Forbidden-pattern scan runs BEFORE any DB connect; bails out on match.
//   * SQL is executed in a single BEGIN/COMMIT (rollback on any error).
//   * Never prints DSN, password, or full connection string. Host-only logs.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SQL_PATH = join(REPO_ROOT, 'db', 'yandex', 'incremental', '2026_05_app_auth_runtime.sql');
const REPORT_PATH = join(REPO_ROOT, 'docs', 'yandex-migration', '30_APP_AUTH_SCHEMA_APPLY_RESULT.md');

const DRY_RUN = process.argv.includes('--dry-run');

const FORBIDDEN_PATTERNS = [
  { name: 'CREATE EXTENSION',       re: /\bCREATE\s+EXTENSION\b/i },
  { name: 'CREATE ROLE',            re: /\bCREATE\s+ROLE\b/i },
  { name: 'ALTER ROLE',             re: /\bALTER\s+ROLE\b/i },
  { name: 'ALTER SYSTEM',           re: /\bALTER\s+SYSTEM\b/i },
  { name: 'session_replication_role', re: /\bsession_replication_role\b/i },
];

function loadDotenv() {
  const path = join(__dirname, '.env.app-auth');
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch { /* absent */ }
}

function hostOnly(dsn) {
  try {
    const u = new URL(dsn);
    return `${u.host}${u.pathname || ''}`;
  } catch {
    return '<unparsable>';
  }
}

function stripComments(sql) {
  // Strip /* ... */ block comments and -- line comments so forbidden-pattern
  // scan doesn't false-trigger on the file's own warning text.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
}

function summarize(sql) {
  const stripped = stripComments(sql);
  const count = (re) => (stripped.match(re) || []).length;
  return {
    createSchema:  count(/\bCREATE\s+SCHEMA\b/gi),
    createTable:   count(/\bCREATE\s+TABLE\b/gi),
    createIndex:   count(/\bCREATE\s+INDEX\b/gi),
    commentOn:     count(/\bCOMMENT\s+ON\b/gi),
    bytes:         sql.length,
  };
}

function appendReport(content) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  let existing = '';
  try { existing = readFileSync(REPORT_PATH, 'utf8'); } catch { /* fresh */ }
  if (!existing) {
    existing = '# 30 — app_auth schema apply result\n\nLog of dry-runs and real applies for `db/yandex/incremental/2026_05_app_auth_runtime.sql`.\n';
  }
  writeFileSync(REPORT_PATH, existing.trimEnd() + '\n\n' + content.trimEnd() + '\n', 'utf8');
}

async function main() {
  loadDotenv();

  let sql;
  try {
    sql = readFileSync(SQL_PATH, 'utf8');
  } catch (err) {
    console.error(`[FAIL] Could not read SQL file ${SQL_PATH}: ${err.message}`);
    process.exit(2);
  }

  // Forbidden-pattern scan — runs BEFORE any DB connect.
  const stripped = stripComments(sql);
  const hits = FORBIDDEN_PATTERNS.filter((p) => p.re.test(stripped));
  if (hits.length > 0) {
    console.error('[FAIL] Forbidden pattern(s) detected in SQL — refusing to proceed:');
    for (const h of hits) console.error(`        - ${h.name}`);
    appendReport([
      `## ${new Date().toISOString()} — forbidden-pattern scan FAILED`,
      '',
      'Refused to apply. Hits:',
      ...hits.map((h) => `- \`${h.name}\``),
    ].join('\n'));
    process.exit(1);
  }

  const stats = summarize(sql);
  const mode = DRY_RUN ? 'dry-run' : 'apply';

  console.log(`[${mode}] SQL: ${SQL_PATH}`);
  console.log(`[${mode}] Summary: ${stats.createSchema} CREATE SCHEMA, ${stats.createTable} CREATE TABLE, ${stats.createIndex} CREATE INDEX, ${stats.commentOn} COMMENT ON (${stats.bytes} bytes).`);
  console.log(`[${mode}] Forbidden-pattern scan: OK (0 hits).`);

  if (DRY_RUN) {
    appendReport([
      `## ${new Date().toISOString()} — dry-run`,
      '',
      `- Source: \`db/yandex/incremental/2026_05_app_auth_runtime.sql\``,
      `- Forbidden-pattern scan: **OK** (0 hits)`,
      `- Summary: ${stats.createSchema} CREATE SCHEMA, ${stats.createTable} CREATE TABLE, ${stats.createIndex} CREATE INDEX, ${stats.commentOn} COMMENT ON (${stats.bytes} bytes)`,
      `- DB connection: skipped (dry-run).`,
    ].join('\n'));
    console.log('[dry-run] No DB connection made. Real apply requires ALLOW_APPLY_APP_AUTH_SCHEMA=true.');
    process.exit(0);
  }

  // Real apply path.
  if (process.env.ALLOW_APPLY_APP_AUTH_SCHEMA !== 'true') {
    console.error('[FAIL] Real apply requires ALLOW_APPLY_APP_AUTH_SCHEMA=true in scripts/app-auth/.env.app-auth.');
    console.error('       Use --dry-run for a no-DB sanity check.');
    process.exit(1);
  }

  const dsn = process.env.YANDEX_DATABASE_URL;
  if (!dsn) {
    console.error('[FAIL] YANDEX_DATABASE_URL is not set (expected in scripts/app-auth/.env.app-auth).');
    process.exit(2);
  }

  const host = hostOnly(dsn);
  console.log(`[apply] Connecting to ${host} ...`);

  const client = new Client({ connectionString: dsn });
  const startedAt = new Date();
  try {
    await client.connect();
  } catch (err) {
    console.error(`[FAIL] Connect failed: ${err.message}`);
    appendReport([
      `## ${startedAt.toISOString()} — apply FAILED (connect)`,
      '',
      `- Target host: \`${host}\``,
      `- Error: ${err.message}`,
    ].join('\n'));
    process.exit(2);
  }

  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    committed = true;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    const finishedAt = new Date();
    console.error(`[FAIL] Apply rolled back: ${err.message}`);
    appendReport([
      `## ${startedAt.toISOString()} — apply ROLLED BACK`,
      '',
      `- Target host: \`${host}\``,
      `- Started:  ${startedAt.toISOString()}`,
      `- Finished: ${finishedAt.toISOString()}`,
      `- Error: ${err.message}`,
    ].join('\n'));
    await client.end().catch(() => {});
    process.exit(1);
  }
  await client.end().catch(() => {});

  const finishedAt = new Date();
  console.log(`[apply] OK — committed in ${finishedAt.getTime() - startedAt.getTime()}ms.`);
  appendReport([
    `## ${startedAt.toISOString()} — apply OK`,
    '',
    `- Target host: \`${host}\``,
    `- Started:  ${startedAt.toISOString()}`,
    `- Finished: ${finishedAt.toISOString()}`,
    `- Forbidden-pattern scan: **OK** (0 hits)`,
    `- Summary: ${stats.createSchema} CREATE SCHEMA, ${stats.createTable} CREATE TABLE, ${stats.createIndex} CREATE INDEX, ${stats.commentOn} COMMENT ON (${stats.bytes} bytes)`,
    `- Status: **${committed ? 'COMMITTED' : 'NOT COMMITTED'}**`,
    `- Next: run \`npm run app-auth:check-schema\` to verify.`,
  ].join('\n'));
}

main().catch((err) => {
  console.error(`[FAIL] ${err.message}`);
  process.exit(2);
});
