#!/usr/bin/env node
// 00_check_connections — read-only reachability/readiness check for the
// PROD Supabase source and the Yandex Managed PostgreSQL target.
//
// SAFETY:
//   - Read-only. Only SELECT / SHOW. Never CREATE/DROP/ALTER/INSERT.
//   - NEVER prints DSN, password, cert contents, or full host.
//   - Source = PROD Supabase ONLY. OLD_SUPABASE_DB_URL is never read or used.
//   - Does not import data or modify either database.
//
// Usage: npm run prod-to-yandex:check
// Env:   scripts/prod-to-yandex/.env.prod-to-yandex (see .example)

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// env loading — scoped to the prod-to-yandex env file; .env/.env.local only as
// fallback; never overwrites an already-set process.env value.
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

// ---------------------------------------------------------------------------
// redaction
// ---------------------------------------------------------------------------
function maskHost(url) {
  try {
    const h = new URL(url).hostname;
    const parts = h.split('.');
    return parts.length > 2 ? `***.${parts.slice(-2).join('.')}` : '***';
  } catch { return '***'; }
}
function hostType(url) {
  if (!url) return 'unset';
  if (/pool|pgbouncer|:6432/i.test(url)) return 'pooler';
  if (/:5432/.test(url)) return 'direct';
  return 'unknown';
}
function sslrootcertOf(url) {
  if (!url) return '';
  try {
    const v = new URL(url).searchParams.get('sslrootcert');
    return v ? v.trim() : '';
  } catch { return ''; }
}
function safeErr(e) {
  const msg = String(e?.message || e?.code || e);
  return msg.replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-conn>');
}

// ---------------------------------------------------------------------------
// connections
// ---------------------------------------------------------------------------
async function connectStrict(url, caPem, appName) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: url,
    ssl: { ca: caPem, rejectUnauthorized: true },
    statement_timeout: 15000,
    query_timeout: 15000,
    connectionTimeoutMillis: 12000,
    application_name: appName,
  });
  await client.connect();
  return client;
}

// Supabase requires TLS but uses its own chain; mirrors the proven
// scripts/old-to-prod/_lib.mjs getClient() behaviour. Read-only here.
async function connectSupabase(url, appName) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 15000,
    query_timeout: 15000,
    connectionTimeoutMillis: 12000,
    application_name: appName,
  });
  await client.connect();
  return client;
}

function majorOf(versionStr) {
  return (String(versionStr).match(/PostgreSQL\s+(\d+)/) || [])[1] || '?';
}

const results = []; // { name, ok, detail }
function rec(name, ok, detail) { results.push({ name, ok, detail: detail || '' }); }

async function main() {
  loadEnv();

  const prodUrl = env('PROD_SUPABASE_DB_URL');
  const yaUrl = env('YANDEX_DATABASE_URL');
  const expectedMajor = env('YANDEX_EXPECTED_PG_MAJOR') || '17';

  if (!prodUrl || !yaUrl) {
    console.error('✗ prod-to-yandex check not run — required env missing:');
    if (!prodUrl) console.error('  - PROD_SUPABASE_DB_URL (the ONLY valid source)');
    if (!yaUrl) console.error('  - YANDEX_DATABASE_URL (target)');
    console.error('  1) cp scripts/prod-to-yandex/.env.prod-to-yandex.example \\');
    console.error('       scripts/prod-to-yandex/.env.prod-to-yandex');
    console.error('  2) fill from Lockbox/Vault (git-ignored — never commit)');
    console.error('  3) npm run prod-to-yandex:check');
    process.exit(2);
  }

  // Hard guard: OLD must never be the source for the Yandex stage.
  if (env('OLD_SUPABASE_DB_URL')) {
    console.error('✗ OLD_SUPABASE_DB_URL is set but is FORBIDDEN as a Yandex-stage');
    console.error('  source (see docs/yandex-migration/00_SOURCE_OF_TRUTH.md). This');
    console.error('  script never reads it; remove it from the prod-to-yandex env.');
    process.exit(2);
  }

  console.log('▶ prod-to-yandex connection check (read-only). Secrets never printed.');
  console.log(`  PROD source : host=${maskHost(prodUrl)} type=${hostType(prodUrl)}`);
  console.log(`  Yandex tgt  : host=${maskHost(yaUrl)} type=${hostType(yaUrl)}`);

  // ---- PROD Supabase (source) ----
  let prodMajor = '?';
  let prodClient;
  try {
    prodClient = await connectSupabase(prodUrl, 'prod-to-yandex-check-prod');
    const { rows: [v] } = await prodClient.query('SELECT version() AS version');
    prodMajor = majorOf(v.version);
    const { rows: [t] } = await prodClient.query(`
      SELECT to_regclass('public.users') IS NOT NULL AS public_users,
             to_regclass('auth.users')   IS NOT NULL AS auth_users`);
    rec('PROD connection', true, `PostgreSQL major=${prodMajor}`);
    rec('PROD source tables', !!(t.public_users && t.auth_users),
      `public.users=${t.public_users ? 'ok' : 'MISSING'} auth.users=${t.auth_users ? 'ok' : 'MISSING'}`);
  } catch (e) {
    rec('PROD connection', false, safeErr(e));
  } finally {
    if (prodClient) await prodClient.end().catch(() => {});
  }

  // ---- Yandex (target), strict verify-full ----
  let caPem = null;
  let caSource = 'YANDEX_SSL_ROOT_CERT';
  let caPath = env('YANDEX_SSL_ROOT_CERT');
  if (!caPath) {
    caPath = sslrootcertOf(yaUrl) || sslrootcertOf(env('YANDEX_DIRECT_DATABASE_URL'));
    if (caPath) caSource = 'DSN sslrootcert';
  }
  if (!caPath) {
    rec('Yandex SSL verify-full', false, 'CA unset (env + DSN) — refusing insecure connect');
  } else if (!existsSync(caPath)) {
    rec('Yandex SSL verify-full', false, `CA file not found (${caSource})`);
  } else {
    try {
      caPem = readFileSync(caPath, 'utf8');
      rec('Yandex SSL verify-full', true, `CA loaded from ${caSource}; rejectUnauthorized=true`);
    } catch (e) {
      rec('Yandex SSL verify-full', false, `CA read error: ${safeErr(e)}`);
    }
  }

  let yaMajor = '?';
  if (caPem) {
    let yc;
    try {
      yc = await connectStrict(yaUrl, caPem, 'prod-to-yandex-check-yandex');
      const q = async (sql) => (await yc.query(sql)).rows;
      const [{ version }] = await q('SELECT version() AS version');
      yaMajor = majorOf(version);
      rec('Yandex connection', true, `PostgreSQL major=${yaMajor}`);

      rec('Yandex PG major',
        yaMajor === String(expectedMajor),
        `major=${yaMajor} (expected ${expectedMajor})`);

      const exts = (await q("SELECT extname FROM pg_extension ORDER BY extname"))
        .map((r) => r.extname);
      for (const ext of ['pgcrypto', 'uuid-ossp']) {
        rec(`Yandex extension ${ext}`, exts.includes(ext),
          exts.includes(ext) ? 'enabled' : 'NOT enabled (enable at cluster level)');
      }

      const [{ n: userTables }] = await q(
        "SELECT count(*)::int AS n FROM pg_tables " +
        "WHERE schemaname NOT IN ('pg_catalog','information_schema')");
      rec('Yandex target empty/ready', Number(userTables) === 0,
        Number(userTables) === 0 ? '0 user tables (empty/ready)' : `${userTables} user table(s) present`);
    } catch (e) {
      rec('Yandex connection', false, safeErr(e));
    } finally {
      if (yc) await yc.end().catch(() => {});
    }
  }

  // ---- cross-check: both majors equal ----
  if (prodMajor !== '?' && yaMajor !== '?') {
    rec('PROD/Yandex PG major match', prodMajor === yaMajor,
      `prod=${prodMajor} yandex=${yaMajor}`);
  }

  // ---- report ----
  console.log('\nChecks:');
  let failed = 0;
  for (const r of results) {
    const sym = r.ok ? '✓' : '✗';
    if (!r.ok) failed++;
    console.log(`  ${sym} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }

  if (failed === 0) {
    console.log('\n✓ prod-to-yandex check passed (read-only; nothing written).');
    process.exit(0);
  }
  console.error(`\n✗ prod-to-yandex check: ${failed} check(s) failed.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`✗ unexpected error: ${safeErr(e)}`);
  if (process.env.DEBUG === 'true' && e?.stack) console.error(e.stack);
  process.exit(1);
});
