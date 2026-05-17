#!/usr/bin/env node
// 01_apply_schema — apply the cleaned db/yandex/sql/*.sql foundation to the
// Yandex Managed PostgreSQL target, in lexical file order.
//
// SAFETY:
//   - Schema only (DDL/functions/triggers). Does NOT import data.
//   - NEVER prints DSN, password, or cert contents.
//   - Real apply requires env ALLOW_APPLY_SCHEMA=true (two-key: flag + a
//     non-dry-run invocation by the operator). Default = refuse.
//   - --dry-run never connects and never applies.
//   - Fails on the FIRST SQL error (per-file transaction, ROLLBACK + stop).
//
// Usage:
//   npm run prod-to-yandex:schema -- --dry-run
//   npm run prod-to-yandex:schema -- --from 03_tables.sql --to 06_indexes_constraints.sql --dry-run
//   ALLOW_APPLY_SCHEMA=true npm run prod-to-yandex:schema       # real apply
//
// Env: scripts/prod-to-yandex/.env.prod-to-yandex (see .example)

import { readFileSync, existsSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SQL_DIR = join(REPO_ROOT, 'db', 'yandex', 'sql');
const REPORT = join(REPO_ROOT, 'docs', 'yandex-migration', '07_SCHEMA_BUILD_REPORT.md');

// ---------------------------------------------------------------------------
function loadEnv() {
  const candidates = [
    join(__dirname, '.env.prod-to-yandex'),
    join(REPO_ROOT, '.env'),
    join(REPO_ROOT, '.env.local'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let raw;
    try { raw = readFileSync(path, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  }
}
const env = (k) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : '';
};
function maskHost(url) {
  try {
    const h = new URL(url).hostname;
    const p = h.split('.');
    return p.length > 2 ? `***.${p.slice(-2).join('.')}` : '***';
  } catch { return '***'; }
}
function sslrootcertOf(url) {
  if (!url) return '';
  try {
    const v = new URL(url).searchParams.get('sslrootcert');
    return v ? v.trim() : '';
  } catch { return ''; }
}
function safeErr(e) {
  return String(e?.message || e?.code || e).replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-conn>');
}

async function connectStrict(url, caPem) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: url,
    ssl: { ca: caPem, rejectUnauthorized: true },
    statement_timeout: 0,
    query_timeout: 0,
    connectionTimeoutMillis: 12000,
    application_name: 'prod-to-yandex-apply-schema',
  });
  await client.connect();
  return client;
}

function listSqlFiles() {
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function applyRange(files, from, to) {
  let lo = 0;
  let hi = files.length - 1;
  if (from) {
    lo = files.indexOf(from);
    if (lo < 0) throw new Error(`--from "${from}" not found in db/yandex/sql/`);
  }
  if (to) {
    hi = files.indexOf(to);
    if (hi < 0) throw new Error(`--to "${to}" not found in db/yandex/sql/`);
  }
  if (lo > hi) throw new Error(`--from "${from}" is after --to "${to}"`);
  return files.slice(lo, hi + 1);
}

function appendReport(section) {
  const header = '# 07. SCHEMA BUILD REPORT\n';
  if (!existsSync(REPORT)) {
    writeFileSync(REPORT, header + '\n', 'utf8');
  }
  appendFileSync(REPORT, section, 'utf8');
}

async function main() {
  loadEnv();

  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      from: { type: 'string' },
      to: { type: 'string' },
    },
  });
  const dryRun = values['dry-run'] === true;

  let files;
  try {
    files = applyRange(listSqlFiles(), values.from, values.to);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
  if (files.length === 0) {
    console.error('✗ no .sql files selected.');
    process.exit(2);
  }

  console.log(`▶ prod-to-yandex schema apply ${dryRun ? '(DRY-RUN)' : ''}`);
  console.log(`  sql dir : db/yandex/sql/`);
  console.log(`  files   : ${files.length} (${files[0]} … ${files[files.length - 1]})`);
  files.forEach((f, i) => console.log(`   ${String(i + 1).padStart(2)}. ${f}`));

  const ts = new Date().toISOString();

  // ---- DRY-RUN: never connect, never apply ----
  if (dryRun) {
    console.log('\n✓ DRY-RUN — no DB connection, nothing applied.');
    appendReport(
      `\n## Apply run ${ts} — DRY-RUN\n\n` +
      `- Mode: dry-run (no connection, no changes)\n` +
      `- Range: ${values.from || '(start)'} → ${values.to || '(end)'}\n` +
      `- Planned files (${files.length}): ${files.join(', ')}\n`,
    );
    process.exit(0);
  }

  // ---- Real apply: two-key guard ----
  if (env('ALLOW_APPLY_SCHEMA') !== 'true') {
    console.error('✗ Real apply refused: ALLOW_APPLY_SCHEMA != true.');
    console.error('  Set ALLOW_APPLY_SCHEMA=true (env file or shell) AND re-run');
    console.error('  WITHOUT --dry-run only when the operator authorises it.');
    console.error('  See docs/yandex-migration/05_CUTOVER_RULES.md.');
    process.exit(2);
  }

  const yaUrl = env('YANDEX_DATABASE_URL');
  if (!yaUrl) {
    console.error('✗ YANDEX_DATABASE_URL not set.');
    process.exit(2);
  }
  let caPath = env('YANDEX_SSL_ROOT_CERT') || sslrootcertOf(yaUrl)
    || sslrootcertOf(env('YANDEX_DIRECT_DATABASE_URL'));
  if (!caPath || !existsSync(caPath)) {
    console.error('✗ Yandex CA not available (YANDEX_SSL_ROOT_CERT or DSN sslrootcert).');
    console.error('  Refusing insecure connection (verify-full required).');
    process.exit(2);
  }
  const caPem = readFileSync(caPath, 'utf8');

  console.log(`\n  target  : host=${maskHost(yaUrl)} (verify-full)`);

  let client;
  try {
    client = await connectStrict(yaUrl, caPem);
  } catch (e) {
    console.error(`✗ connection failed: ${safeErr(e)}`);
    process.exit(1);
  }

  const applied = [];
  let failedFile = null;
  let failErr = null;
  try {
    for (const f of files) {
      const sql = readFileSync(join(SQL_DIR, f), 'utf8');
      process.stdout.write(`  applying ${f} … `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        applied.push(f);
        console.log('ok');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        failedFile = f;
        failErr = safeErr(e);
        console.log('FAILED');
        break; // fail on first SQL error
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  const ok = failedFile === null;
  appendReport(
    `\n## Apply run ${ts} — ${ok ? 'SUCCESS' : 'FAILED'}\n\n` +
    `- Target host: ${maskHost(yaUrl)} (verify-full)\n` +
    `- Range: ${values.from || '(start)'} → ${values.to || '(end)'}\n` +
    `- Applied (${applied.length}): ${applied.join(', ') || '(none)'}\n` +
    (ok
      ? `- Result: all selected files applied; no data imported.\n`
      : `- Result: STOPPED at \`${failedFile}\` — first SQL error: ${failErr}\n`),
  );

  if (ok) {
    console.log(`\n✓ schema applied (${applied.length} files). No data imported.`);
    console.log(`  report: ${REPORT}`);
    process.exit(0);
  }
  console.error(`\n✗ apply FAILED at ${failedFile}: ${failErr}`);
  console.error(`  report: ${REPORT}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`✗ unexpected error: ${safeErr(e)}`);
  if (process.env.DEBUG === 'true' && e?.stack) console.error(e.stack);
  process.exit(1);
});
