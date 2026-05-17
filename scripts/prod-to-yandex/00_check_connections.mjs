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
//
// Also checks: PROD reachable (with clear connectivity diagnostics — host
// type, timeout reason, IPv6/direct-host warning, EXPORT-override suggestion),
// Yandex reachable, PG majors, Yandex pgcrypto+uuid-ossp, AND that the Yandex
// schema verify doc (09_SCHEMA_VERIFY_RESULT.md) already reads SCHEMA_VERIFY_OK.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCHEMA_VERIFY_DOC = join(REPO_ROOT, 'docs', 'yandex-migration', '09_SCHEMA_VERIFY_RESULT.md');

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
  if (/yandexcloud\.net/i.test(url)) return 'yandex';
  if (/pooler\.supabase\.com/i.test(url)) return 'pooler';
  if (/\.supabase\.co/i.test(url)) return 'direct';
  if (/pool|pgbouncer|:6432/i.test(url)) return 'pooler';
  if (/:5432/.test(url)) return 'direct';
  return 'unknown';
}

// Classify a PROD connect failure into an actionable diagnostic. NEVER prints
// the DSN. Surfaces: host type, timeout reason, IPv6/direct-host warning, and
// the PROD_SUPABASE_EXPORT_DB_URL pooler/session override suggestion.
function diagnoseProdFailure(e, url) {
  const ht = hostType(url);
  const code = e?.code || '';
  const lines = [];
  if (code === 'ETIMEDOUT' || /timeout/i.test(String(e?.message))) {
    lines.push('connect/query TIMED OUT.');
    if (ht === 'direct') {
      lines.push('Direct host db.<ref>.supabase.co is IPv6-only on Supabase free-tier;');
      lines.push('most networks cannot reach it. Use the Session Pooler instead.');
    }
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    lines.push('DNS could not resolve the PROD host (ENOTFOUND/EAI_AGAIN).');
  } else if (code === 'ECONNREFUSED') {
    lines.push('connection refused — wrong port or the endpoint is down.');
  } else {
    lines.push(safeErr(e));
  }
  lines.push(
    'Fix: set PROD_SUPABASE_EXPORT_DB_URL to a Supabase Session Pooler / ' +
    'session-mode endpoint (aws-0-<region>.pooler.supabase.com:5432) — the ' +
    'export & verify scripts prefer it over PROD_SUPABASE_DB_URL.',
  );
  return lines;
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

  const prodBaseUrl = env('PROD_SUPABASE_DB_URL');
  const prodExportUrl = env('PROD_SUPABASE_EXPORT_DB_URL');
  // Export & verify prefer the EXPORT override; check probes the same one.
  const prodUrl = prodExportUrl || prodBaseUrl;
  const usingExportOverride = !!prodExportUrl;
  const yaUrl = env('YANDEX_DATABASE_URL');
  const expectedMajor = env('YANDEX_EXPECTED_PG_MAJOR') || '17';

  if (!prodUrl || !yaUrl) {
    console.error('✗ prod-to-yandex check not run — required env missing:');
    if (!prodUrl) console.error('  - PROD_SUPABASE_DB_URL or PROD_SUPABASE_EXPORT_DB_URL (the ONLY valid source)');
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
  console.log(`  PROD source : host=${maskHost(prodUrl)} type=${hostType(prodUrl)}` +
    `${usingExportOverride ? ' (via PROD_SUPABASE_EXPORT_DB_URL)' : ''}`);
  console.log(`  Yandex tgt  : host=${maskHost(yaUrl)} type=${hostType(yaUrl)}`);
  if (hostType(prodUrl) === 'direct' && !usingExportOverride) {
    console.log('  ⚠ PROD host looks like the direct db.<ref>.supabase.co endpoint');
    console.log('    (IPv6-only on free-tier). If the connect below times out, set');
    console.log('    PROD_SUPABASE_EXPORT_DB_URL to the Session Pooler endpoint.');
  }

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
    rec('PROD connection', true, `PostgreSQL major=${prodMajor} (host type ${hostType(prodUrl)})`);
    rec('PROD source tables', !!(t.public_users && t.auth_users),
      `public.users=${t.public_users ? 'ok' : 'MISSING'} auth.users=${t.auth_users ? 'ok' : 'MISSING'}`);
  } catch (e) {
    const diag = diagnoseProdFailure(e, prodUrl);
    rec('PROD connection', false, diag[0]);
    console.error('\n  PROD connectivity diagnostic:');
    for (const l of diag) console.error(`    - ${l}`);
  } finally {
    if (prodClient) await prodClient.end().catch(() => {});
  }

  // ---- Yandex schema-verify doc status (read once; used by readiness) ----
  let schemaStatus = null;
  if (existsSync(SCHEMA_VERIFY_DOC)) {
    try {
      const raw = readFileSync(SCHEMA_VERIFY_DOC, 'utf8');
      const m = raw.match(/SCHEMA_VERIFY_(OK_WITH_WARNINGS|OK|FAILED)/);
      schemaStatus = m ? m[0] : null;
    } catch { schemaStatus = null; }
  }
  const schemaApplied = schemaStatus === 'SCHEMA_VERIFY_OK';

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

      // ---- data-phase-aware target readiness ----
      // Schema phase: empty DB (0 user tables) is ready for schema apply.
      // Data phase: schema-applied target with all app/auth tables at 0 rows
      // is the EXPECTED ready state — tables existing is NOT a failure.
      const nonSys = (await q(
        "SELECT nspname FROM pg_namespace " +
        "WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast') " +
        "AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%' " +
        "ORDER BY nspname")).map((r) => r.nspname);
      const ALLOWED_SCHEMAS = new Set(['public', 'auth']);
      const unexpectedSchemas = nonSys.filter((s) => !ALLOWED_SCHEMAS.has(s));

      const tbls = await q(
        "SELECT schemaname, tablename FROM pg_tables " +
        "WHERE schemaname IN ('public','auth') ORDER BY schemaname, tablename");
      let totalRows = 0;
      const nonEmpty = [];
      for (const { schemaname, tablename } of tbls) {
        const [{ n }] = await q(`SELECT count(*)::bigint AS n FROM "${schemaname}"."${tablename}"`);
        const c = Number(n);
        totalRows += c;
        if (c > 0) nonEmpty.push(`${schemaname}.${tablename}=${c}`);
      }
      const allowClean = env('ALLOW_CLEAN_YANDEX') === 'true';
      const neShort = nonEmpty.slice(0, 5).join(', ') + (nonEmpty.length > 5 ? ', …' : '');

      if (unexpectedSchemas.length) {
        rec('Yandex target readiness', false,
          `unexpected non-system schema(s): ${unexpectedSchemas.join(', ')}`);
      } else if (!schemaApplied) {
        if (tbls.length === 0) {
          rec('Yandex target readiness', true,
            '0 user tables (empty — ready for schema apply)');
        } else {
          rec('Yandex target readiness', false,
            `${tbls.length} user table(s) present but schema not verified ` +
            `(run \`npm run prod-to-yandex:verify-schema\`)`);
        }
      } else if (tbls.length === 0) {
        rec('Yandex target readiness', false,
          'schema verify OK but no public/auth tables present (inconsistent state)');
      } else if (totalRows === 0) {
        rec('Yandex target readiness', true,
          `schema-applied empty target: OK — ${tbls.length} tables, 0 rows ` +
          `(ready for first import)`);
      } else if (allowClean) {
        rec('Yandex target readiness', true,
          `schema-applied but NON-EMPTY (${neShort}); ALLOW_CLEAN_YANDEX=true ` +
          `permits --clean-yandex --confirm before import`);
      } else {
        rec('Yandex target readiness', false,
          `target NOT empty (${neShort}) — first import needs ` +
          `--clean-yandex --confirm + ALLOW_CLEAN_YANDEX=true`);
      }
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

  // ---- Yandex schema must already be verified OK ----
  if (schemaApplied) {
    rec('Yandex schema verified', true, 'docs/yandex-migration/09_SCHEMA_VERIFY_RESULT.md = SCHEMA_VERIFY_OK');
  } else {
    rec('Yandex schema verified', false,
      `09_SCHEMA_VERIFY_RESULT.md = ${schemaStatus ?? '(missing)'} — run \`npm run prod-to-yandex:verify-schema\` first`);
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
