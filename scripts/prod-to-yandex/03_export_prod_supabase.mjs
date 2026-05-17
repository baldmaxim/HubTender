#!/usr/bin/env node
// 03_export_prod_supabase — read-only dump of PROD Supabase into
// EXPORT_DIR/data/*.ndjson for the Yandex import stage.
//
// =============================== SAFETY ====================================
//  - Source = PROD_SUPABASE_EXPORT_DB_URL (if set) else PROD_SUPABASE_DB_URL.
//    OLD_SUPABASE_DB_URL is FORBIDDEN — assertNoOldEnv() fails fast (exit 7).
//  - Read-only. Default mode = one REPEATABLE READ READ ONLY snapshot (cross-
//    table consistency). --pool-safe-export = per-table connection (use when
//    the only path is the shared Session Pooler).
//  - Connects like old-to-prod getClient: ssl rejectUnauthorized:false, raw
//    json/jsonb/temporal parsers, UTC + ISO/MDY session, fail-fast self-check.
//  - NEVER logs DSN / passwords / encrypted_password. Host shown by type only.
//  - duplicate_pk_total > 0 ALWAYS fails the export (exit 8).
//  - Exit codes: 0 ok · 2 config/precondition · 7 guard · 8 dup-pk · 1 fail.
// ===========================================================================

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadEnv, env, requireEnv, getExportDir, getSupabaseClient, redactHostType,
  tag, writeJson, parseCliArgs, fatal, assertNoOldEnv, assertTemporalRawParsers,
  DOC_DIR,
} from './_lib.mjs';
import { IMPORT_ORDER, AUTH_IMPORT_ORDER, defaultOrderBy, CHECKSUM_TABLES, HEAVY_CHECKSUM_TABLES } from './_tables.mjs';
import { streamTableKeyset, writeNdjson, validateNdjsonPks, tableExists } from './_copy.mjs';
import { loadAuthUsersForExport, loadIdentitiesForExport, collectAuthStats } from './_auth.mjs';
import { sha256OfFile, tableChecksumSql, chunkedTableChecksum, HEAVY_CHECKSUM_CHUNK, JSONB_TABLES } from './_checksums.mjs';
import { writeFileSync } from 'node:fs';

loadEnv();

// Source label is recorded literally; the project ref is only recorded if it
// appears in a NON-SECRET place (this constant), never parsed out of the DSN.
const SOURCE_PROJECT_REF = 'ocauafggjrqvopxjihas';

const EXPORT_REPORT = join(DOC_DIR, '11_DATA_EXPORT_REPORT.md');

if (!process.env.PG_QUERY_TIMEOUT_MS || parseInt(process.env.PG_QUERY_TIMEOUT_MS, 10) < 3_600_000) {
  process.env.PG_QUERY_TIMEOUT_MS = '3600000'; // 60 min — heavy jsonb tables
}

const { values } = parseCliArgs({
  name: '03_export_prod_supabase.mjs',
  description: 'Read-only export of PROD Supabase to EXPORT_DIR/data/*.ndjson.',
  options: {
    'dry-run':          { type: 'boolean', default: false, describe: 'Probe + counts only; do not write NDJSON/manifest' },
    'batch-size':       { type: 'string',  default: '',    describe: 'Keyset page size (default 5000 snapshot / 2500 pool-safe)' },
    'export-dir':       { type: 'string',  default: '',    describe: 'Override EXPORT_DIR env' },
    'pool-safe-export': { type: 'boolean', default: false, describe: 'Per-table connection, no global REPEATABLE READ snapshot' },
  },
});

const exportDir = values['export-dir'] || env('EXPORT_DIR') || getExportDir();
const poolSafe = values['pool-safe-export'];
const batchSize = parseInt(values['batch-size'], 10) || (poolSafe ? 2500 : 5000);
const dryRun = values['dry-run'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shouldChunk(table, rowCount, mode) {
  if (HEAVY_CHECKSUM_TABLES.has(table)) return true;
  if (mode === 'pool-safe' && rowCount > 100_000) return true;
  return false;
}

async function main() {
  // Hard guard FIRST.
  try {
    assertNoOldEnv();
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(7);
  }

  let sourceUrl;
  const usingOverride = !!env('PROD_SUPABASE_EXPORT_DB_URL');
  try {
    sourceUrl = usingOverride ? env('PROD_SUPABASE_EXPORT_DB_URL') : requireEnv('PROD_SUPABASE_DB_URL');
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error('  Source for the Yandex stage = PROD Supabase ONLY.');
    process.exit(2);
  }

  const hostType = redactHostType(sourceUrl);
  mkdirSync(join(exportDir, 'data'), { recursive: true });
  const mode = poolSafe ? 'pool-safe' : 'snapshot';
  const appName = poolSafe ? 'prod-to-yandex-export-pool-safe' : 'prod-to-yandex-export-snapshot';

  console.log(
    `${tag('PROD')} export mode: ${mode}` +
    `${usingOverride ? ' (via PROD_SUPABASE_EXPORT_DB_URL)' : ''}` +
    `, host type: ${hostType}, batch=${batchSize}${dryRun ? ' (dry-run)' : ''}`,
  );
  if (poolSafe && hostType === 'pooler') {
    console.log(`${tag('PROD')} ⚠ pool-safe on a pooler URL — set PROD_SUPABASE_EXPORT_DB_URL to a direct/session endpoint when available.`);
  }

  try {
    if (mode === 'pool-safe') return await runPoolSafeExport({ url: sourceUrl, appName, hostType, usingOverride });
    return await runSnapshotExport({ url: sourceUrl, appName, hostType, usingOverride });
  } catch (e) {
    // Source unreachable / read failure (incl. PROD timeout): record a clear
    // blocker in 11_DATA_EXPORT_REPORT.md, print actionable guidance, no stack
    // trace. Applies in dry-run too (the report must never be left stale).
    const lines = diagnoseProdConnFailure(e, hostType, usingOverride);
    writeFailureReport(lines);
    console.error(`${tag('PROD')} ✗ export halted — source not reachable / precondition not met:`);
    for (const ln of lines) console.error(`  ${ln}`);
    fatal(e);
  }
}

function mkManifest({ sourceVersion, mode, snapshotStartedAt, usingOverride }) {
  return {
    generated_at: new Date().toISOString(),
    source_db_version: sourceVersion,
    source_label: 'PROD_SUPABASE',
    source_project_ref: SOURCE_PROJECT_REF, // from a non-secret constant, NOT parsed from the DSN
    source_url_override: usingOverride,
    export_format: 'NDJSON',
    dry_run: dryRun,
    consistency_mode: mode === 'snapshot' ? 'repeatable_read_snapshot' : 'operator_no_writes_pool_safe',
    pool_safe_export: mode === 'pool-safe',
    transaction_snapshot: mode === 'snapshot',
    operator_confirmed_no_writes_required: mode === 'pool-safe',
    raw_type_parsers: true,
    session_time_zone: 'UTC',
    date_style: 'ISO, MDY',
    snapshot_started_at: snapshotStartedAt,
    snapshot_committed_at: null,
    tables: [],
    row_counts: {},
    tender_registry_duplicates: null,
    warnings: [
      'auth.sessions / auth.refresh_tokens are intentionally NOT exported. ' +
      'Yandex has no GoTrue; users re-login after the app-auth cutover.',
    ],
  };
}

function mkValidation(mode) {
  return {
    generated_at: null,
    consistency_mode: mode === 'snapshot' ? 'repeatable_read_snapshot' : 'operator_no_writes_pool_safe',
    pool_safe_export: mode === 'pool-safe',
    transaction_snapshot: mode === 'snapshot',
    raw_type_parser_check: null,
    session_time_zone: 'UTC',
    date_style: 'ISO, MDY',
    tables: [],
    duplicate_pk_total: 0,
    errors: [],
    warnings: mode === 'pool-safe'
      ? ['Pool-safe export skips REPEATABLE READ snapshot. Cross-table consistency relies on an operator-confirmed write-freeze of PROD.']
      : [],
  };
}

async function exportPublicTable({ client, table, mode }) {
  if (!(await tableExists(client, 'public', table))) return { skipped: true, table };
  const { rows: [c] } = await client.query(`SELECT COUNT(*)::int AS n FROM "public"."${table}"`);
  const rowCount = c.n;
  const pkColumn = defaultOrderBy(table);
  const ndjsonPath = join(exportDir, 'data', `public.${table}.ndjson`);
  let bytes = 0;
  if (!dryRun && rowCount > 0) {
    const r = await writeNdjson(ndjsonPath, streamTableKeyset(client, { schema: 'public', table, pkColumn, batchSize }));
    bytes = r.bytes;
  }
  const checksum = dryRun || rowCount === 0 ? null : await sha256OfFile(ndjsonPath);

  let sqlChecksum = null, sqlChecksumMode = null, sqlChecksumChunk = null;
  if (!dryRun && rowCount > 0 && CHECKSUM_TABLES.includes(table)) {
    if (shouldChunk(table, rowCount, mode)) {
      sqlChecksumChunk = HEAVY_CHECKSUM_CHUNK;
      sqlChecksum = await chunkedTableChecksum(client, { schema: 'public', table, orderBy: pkColumn, chunkSize: sqlChecksumChunk });
      sqlChecksumMode = 'chunked';
    } else {
      const { rows: [r] } = await client.query(tableChecksumSql('public', table, pkColumn));
      sqlChecksum = r?.checksum ?? null;
      sqlChecksumMode = 'full';
    }
  }

  let valid = { total: 0, distinct: 0, duplicates: 0, sample_duplicate_pks: [] };
  if (!dryRun && rowCount > 0) valid = await validateNdjsonPks(ndjsonPath, pkColumn);

  return {
    skipped: false, schema: 'public', table, rowCount, pkColumn, bytes,
    ndjsonPath: dryRun ? null : `data/public.${table}.ndjson`,
    checksum, sqlChecksum, sqlChecksumMode, sqlChecksumChunk,
    has_jsonb: JSONB_TABLES.has(table), valid, mode,
  };
}

async function exportAuth({ client }) {
  const entries = [];
  const logLines = [];
  const usersPath = join(exportDir, 'data', 'auth.users.ndjson');
  const identPath = join(exportDir, 'data', 'auth.identities.ndjson');

  if (await tableExists(client, 'auth', 'users')) {
    const { rows: [c] } = await client.query('SELECT COUNT(*)::int AS n FROM auth.users');
    const rowCount = c.n;
    let bytes = 0;
    if (!dryRun && rowCount > 0) {
      const r = await writeNdjson(usersPath, loadAuthUsersForExport(client, { batchSize: 500 }));
      bytes = r.bytes;
    }
    let valid = { total: 0, distinct: 0, duplicates: 0, sample_duplicate_pks: [] };
    if (!dryRun && rowCount > 0) valid = await validateNdjsonPks(usersPath, 'id');
    entries.push({
      table: 'auth.users', schema: 'auth', tableName: 'users', rowCount, bytes,
      ndjsonPath: dryRun ? null : 'data/auth.users.ndjson',
      checksum: dryRun || rowCount === 0 ? null : await sha256OfFile(usersPath),
      valid, note: 'encrypted_password preserved byte-to-byte; never printed in any log',
    });
    const dup = valid.duplicates > 0 ? ` ⚠ dup_pk=${valid.duplicates}` : '';
    logLines.push(`${tag('PROD')} ${String(rowCount).padStart(8)} auth.users${dryRun ? ' (dry-run)' : ''}${dup}`);
  }

  if (await tableExists(client, 'auth', 'identities')) {
    const { rows: [c] } = await client.query('SELECT COUNT(*)::int AS n FROM auth.identities');
    const rowCount = c.n;
    let bytes = 0;
    if (!dryRun && rowCount > 0) {
      const r = await writeNdjson(identPath, loadIdentitiesForExport(client, { batchSize: 500 }));
      bytes = r.bytes;
    }
    let valid = { total: 0, distinct: 0, duplicates: 0, sample_duplicate_pks: [] };
    if (!dryRun && rowCount > 0) valid = await validateNdjsonPks(identPath, 'id');
    entries.push({
      table: 'auth.identities', schema: 'auth', tableName: 'identities', rowCount, bytes,
      ndjsonPath: dryRun ? null : 'data/auth.identities.ndjson',
      checksum: dryRun || rowCount === 0 ? null : await sha256OfFile(identPath),
      valid, note: 'email column is GENERATED on the Yandex target — not exported',
    });
    const dup = valid.duplicates > 0 ? ` ⚠ dup_pk=${valid.duplicates}` : '';
    logLines.push(`${tag('PROD')} ${String(rowCount).padStart(8)} auth.identities${dryRun ? ' (dry-run)' : ''}${dup}`);
  }
  return { entries, logLines };
}

function ingestValidation(validation, name, valid) {
  if (!valid) return;
  validation.tables.push({
    table: name, ndjson_lines: valid.total, distinct_pk_count: valid.distinct,
    duplicate_pk_count: valid.duplicates, sample_duplicate_pks: valid.sample_duplicate_pks,
  });
  validation.duplicate_pk_total += valid.duplicates;
  if (valid.duplicates > 0) {
    validation.errors.push(`${name}: ${valid.duplicates} duplicate PK(s) in NDJSON — export inconsistent.`);
  }
}

function pushPublic(manifest, table, e) {
  manifest.row_counts[`public.${table}`] = e.rowCount;
  manifest.tables.push({
    schema: 'public', table, rows: e.rowCount, row_count: e.rowCount,
    distinct_pk_count: e.valid?.distinct ?? null, duplicate_pk_count: e.valid?.duplicates ?? 0,
    ndjson_bytes: e.bytes, ndjson_path: e.ndjsonPath, checksum_sha256: e.checksum,
    sql_checksum: e.sqlChecksum, sql_checksum_mode: e.sqlChecksumMode,
    sql_checksum_chunk_size: e.sqlChecksumChunk, has_jsonb: e.has_jsonb, pk_column: e.pkColumn,
  });
}

function pushAuth(manifest, a) {
  manifest.row_counts[a.table] = a.rowCount;
  manifest.tables.push({
    schema: a.schema, table: a.tableName, rows: a.rowCount, row_count: a.rowCount,
    distinct_pk_count: a.valid?.distinct ?? null, duplicate_pk_count: a.valid?.duplicates ?? 0,
    ndjson_bytes: a.bytes, ndjson_path: a.ndjsonPath, checksum_sha256: a.checksum,
    pk_column: 'id', note: a.note,
  });
}

function logPublic(e) {
  const cs = e.sqlChecksum ? (e.sqlChecksumMode === 'chunked' ? ' [sql-cs ✓ chunked]' : ' [sql-cs ✓]') : '';
  const dup = (e.valid?.duplicates ?? 0) > 0 ? ` ⚠ dup_pk=${e.valid.duplicates}` : '';
  console.log(`${tag('PROD')} ${String(e.rowCount).padStart(8)} public.${e.table}${dryRun ? ' (dry-run)' : ''}${cs}${dup}`);
}

async function tenderRegistryDuplicates(client) {
  try {
    const { rows: [r] } = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM (
            SELECT tender_number FROM public.tender_registry
             WHERE tender_number IS NOT NULL GROUP BY tender_number HAVING COUNT(*) > 1) t) AS by_tender_number,
        (SELECT COUNT(*)::int FROM (
            SELECT title, client_name, area FROM public.tender_registry
             WHERE tender_number IS NULL GROUP BY title, client_name, area HAVING COUNT(*) > 1) t) AS by_title_client_area
    `);
    return { by_tender_number: r.by_tender_number, by_title_client_area: r.by_title_client_area };
  } catch {
    return null;
  }
}

async function runSnapshotExport({ url, appName, usingOverride }) {
  console.log(`${tag('PROD')} connecting (snapshot mode)…`);
  const client = await getSupabaseClient(url, { applicationName: appName });
  const validation = mkValidation('snapshot');
  let snapshotOpen = false;
  try {
    validation.snapshot_started_at = new Date().toISOString();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    snapshotOpen = true;
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query('SET LOCAL idle_in_transaction_session_timeout = 0');
    console.log(`${tag('PROD')} snapshot opened (REPEATABLE READ READ ONLY) at ${validation.snapshot_started_at}`);

    const { rows: [v] } = await client.query('SELECT version() AS v');
    console.log(`${tag('PROD')} ${v.v.slice(0, 40)}…`);
    validation.raw_type_parser_check = await assertTemporalRawParsers(client);
    console.log(`${tag('PROD')} raw-parser self-check ✓ (date/timestamp/timestamptz/json/jsonb as raw text, UTC/ISO)`);

    const manifest = mkManifest({ sourceVersion: v.v, mode: 'snapshot', snapshotStartedAt: validation.snapshot_started_at, usingOverride });

    for (const table of IMPORT_ORDER) {
      const e = await exportPublicTable({ client, table, mode: 'snapshot' });
      if (e.skipped) { manifest.warnings.push(`public.${table}: not present in PROD, skipped`); console.log(`${tag('PROD')} skip public.${table} (not present)`); continue; }
      ingestValidation(validation, `public.${table}`, e.valid);
      pushPublic(manifest, table, e);
      logPublic(e);
    }

    const authResult = await exportAuth({ client });
    for (const a of authResult.entries) { ingestValidation(validation, a.table, a.valid); pushAuth(manifest, a); }
    for (const l of authResult.logLines) console.log(l);

    manifest.tender_registry_duplicates = await tenderRegistryDuplicates(client);
    const stats = await collectAuthStats(client);

    await client.query('COMMIT');
    snapshotOpen = false;
    validation.snapshot_committed_at = new Date().toISOString();
    manifest.snapshot_committed_at = validation.snapshot_committed_at;
    console.log(`${tag('PROD')} snapshot committed at ${validation.snapshot_committed_at}`);

    finalize({ manifest, validation, stats });
    enforce(validation, manifest);
  } catch (e) {
    if (snapshotOpen) { try { await client.query('ROLLBACK'); } catch {} console.error(`${tag('PROD')} snapshot rolled back due to error.`); }
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

async function runPoolSafeExport({ url, appName, usingOverride }) {
  console.log(`${tag('PROD')} pool-safe mode: one connection per table, no global transaction.`);
  console.log(`${tag('PROD')} ⚠ cross-table consistency depends on an operator no-writes window on PROD.`);
  const perCall = { applicationName: appName, timeoutMs: 10 * 60_000 };
  const validation = mkValidation('pool-safe');
  const manifest = mkManifest({ sourceVersion: null, mode: 'pool-safe', snapshotStartedAt: null, usingOverride });

  {
    const probe = await getSupabaseClient(url, perCall);
    try {
      const { rows: [v] } = await probe.query('SELECT version() AS v');
      manifest.source_db_version = v.v;
      console.log(`${tag('PROD')} ${v.v.slice(0, 40)}…`);
      validation.raw_type_parser_check = await assertTemporalRawParsers(probe);
      console.log(`${tag('PROD')} raw-parser self-check ✓`);
    } finally { await probe.end().catch(() => {}); }
  }

  for (const table of IMPORT_ORDER) {
    let attempt = 0, e;
    while (true) {
      const client = await getSupabaseClient(url, perCall);
      try {
        e = await exportPublicTable({ client, table, mode: 'pool-safe' });
        break;
      } catch (err) {
        attempt++;
        await client.end().catch(() => {});
        if (attempt > 1) { console.error(`${tag('PROD')} ✗ public.${table} failed after 1 retry: ${err.message}`); throw err; }
        console.warn(`${tag('PROD')} ⚠ public.${table} attempt 1 failed: ${err.message}. Retrying in 5s…`);
        await sleep(5000);
        continue;
      } finally { await client.end().catch(() => {}); }
    }
    if (e.skipped) { manifest.warnings.push(`public.${table}: not present in PROD, skipped`); console.log(`${tag('PROD')} skip public.${table} (not present)`); continue; }
    ingestValidation(validation, `public.${table}`, e.valid);
    pushPublic(manifest, table, e);
    logPublic(e);
    if (HEAVY_CHECKSUM_TABLES.has(table)) await sleep(3000);
  }

  {
    const client = await getSupabaseClient(url, perCall);
    try {
      const authResult = await exportAuth({ client });
      for (const a of authResult.entries) { ingestValidation(validation, a.table, a.valid); pushAuth(manifest, a); }
      for (const l of authResult.logLines) console.log(l);
    } finally { await client.end().catch(() => {}); }
  }
  {
    const client = await getSupabaseClient(url, perCall);
    try { manifest.tender_registry_duplicates = await tenderRegistryDuplicates(client); }
    finally { await client.end().catch(() => {}); }
  }
  let stats;
  {
    const client = await getSupabaseClient(url, perCall);
    try { stats = await collectAuthStats(client); }
    finally { await client.end().catch(() => {}); }
  }

  finalize({ manifest, validation, stats });
  enforce(validation, manifest);
}

function finalize({ manifest, validation, stats }) {
  validation.generated_at = new Date().toISOString();
  if (!dryRun) {
    writeJson(join(exportDir, 'auth_stats.json'), { generated_at: new Date().toISOString(), source_label: 'PROD_SUPABASE', ...stats });
    writeJson(join(exportDir, 'export_validation.json'), validation);
    writeJson(join(exportDir, 'manifest.json'), manifest);
    console.log(`✓ wrote ${join(exportDir, 'manifest.json')}`);
    console.log(`✓ wrote ${join(exportDir, 'export_validation.json')}`);
    console.log(`✓ wrote ${join(exportDir, 'auth_stats.json')}`);
  } else {
    console.log(`✓ dry-run complete (${manifest.tables.length} tables surveyed; nothing written)`);
  }
  console.log(
    `${tag('PROD')} auth_stats: users=${stats.auth_users_count} with_pw=${stats.users_with_encrypted_password} ` +
    `oauth_only=${stats.oauth_only_users_count} orphans=${stats.orphan_auth_users}/${stats.orphan_public_users} ` +
    `dup_emails=${stats.duplicate_emails_in_auth.length}`,
  );
  writeReportMd({ manifest, validation, stats });
}

function writeReportMd({ manifest, validation, stats }) {
  const L = [];
  L.push('# 11. DATA EXPORT REPORT');
  L.push('');
  L.push('> Generated by `scripts/prod-to-yandex/03_export_prod_supabase.mjs`.');
  L.push('> Overwritten on every run. Source = PROD Supabase only.');
  L.push('');
  L.push(`- Run (UTC): ${validation.generated_at}`);
  L.push(`- Mode: **${dryRun ? 'dry-run' : (manifest.pool_safe_export ? 'pool-safe' : 'snapshot')}**`);
  L.push(`- Source label: ${manifest.source_label} (project ref ${manifest.source_project_ref})`);
  L.push(`- Consistency: ${manifest.consistency_mode}`);
  L.push(`- raw_type_parsers: ${manifest.raw_type_parsers} · session TZ: ${manifest.session_time_zone} · DateStyle: ${manifest.date_style}`);
  L.push('');
  L.push('## Row counts');
  L.push('');
  L.push('| Table | Rows | dup-PK | sql-checksum |');
  L.push('|---|---:|---:|---|');
  for (const t of manifest.tables) {
    L.push(`| ${t.schema}.${t.table} | ${t.rows} | ${t.duplicate_pk_count ?? 0} | ${t.sql_checksum ? (t.sql_checksum_mode || 'full') : '—'} |`);
  }
  L.push('');
  L.push('## Auth stats');
  L.push('');
  L.push(`- auth.users: ${stats.auth_users_count} (with password ${stats.users_with_encrypted_password}, oauth-only ${stats.oauth_only_users_count})`);
  L.push(`- auth.identities: ${stats.auth_identities_count}`);
  L.push(`- orphans auth→public / public→auth: ${stats.orphan_auth_users} / ${stats.orphan_public_users}`);
  L.push(`- duplicate emails in auth.users: ${stats.duplicate_emails_in_auth.length}`);
  L.push('');
  L.push('## Validation');
  L.push('');
  L.push(`- duplicate_pk_total: **${validation.duplicate_pk_total}**`);
  if (validation.errors.length) validation.errors.forEach((e) => L.push(`- ❌ ${e}`));
  if (manifest.tender_registry_duplicates) {
    L.push(`- tender_registry duplicates baseline: by_tender_number=${manifest.tender_registry_duplicates.by_tender_number} by_title_client_area=${manifest.tender_registry_duplicates.by_title_client_area}`);
  }
  L.push('');
  const status = dryRun
    ? 'DATA_EXPORT_DRY_RUN_OK'
    : (validation.duplicate_pk_total > 0 ? 'DATA_EXPORT_FAILED' : 'DATA_EXPORT_OK');
  L.push('## Final status');
  L.push('');
  L.push('```');
  L.push(status);
  L.push('```');
  L.push('');
  try { writeFileSync(EXPORT_REPORT, L.join('\n'), 'utf8'); console.log(`✓ wrote ${EXPORT_REPORT}`); }
  catch (e) { console.error(`✗ failed to write ${EXPORT_REPORT}: ${e.message}`); }
}

// Classify a PROD connect/read failure into actionable, DSN-free guidance
// (mirrors 00_check_connections diagnoseProdFailure).
function diagnoseProdConnFailure(err, hostType, usingOverride) {
  const code = err?.code || '';
  const msg = String(err?.message || err);
  const lines = [];
  if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    lines.push('PROD connect/query TIMED OUT.');
    if (hostType === 'direct') {
      lines.push('Direct host db.<ref>.supabase.co is IPv6-only on Supabase free-tier;');
      lines.push('most networks cannot reach it.');
    }
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    lines.push('DNS could not resolve the PROD host (ENOTFOUND/EAI_AGAIN).');
  } else if (code === 'ECONNREFUSED') {
    lines.push('PROD connection refused — wrong port or endpoint down.');
  } else {
    lines.push(msg.replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-conn>'));
  }
  if (!usingOverride) {
    lines.push(
      'Fix: set PROD_SUPABASE_EXPORT_DB_URL to a Supabase Session Pooler endpoint ' +
      '(aws-0-<region>.pooler.supabase.com:5432); export prefers it over ' +
      'PROD_SUPABASE_DB_URL. Then re-run npm run prod-to-yandex:export.',
    );
  } else {
    lines.push('PROD_SUPABASE_EXPORT_DB_URL is in use but still unreachable — ' +
      'verify the pooler/session endpoint, credentials, and network egress.');
  }
  return lines;
}

// Persist a connectivity / precondition blocker into 11_DATA_EXPORT_REPORT.md
// so the report is never left stale (task requirement). Never prints the DSN.
function writeFailureReport(blockerLines) {
  const L = [];
  L.push('# 11. DATA EXPORT REPORT');
  L.push('');
  L.push('> Generated by `scripts/prod-to-yandex/03_export_prod_supabase.mjs`.');
  L.push('> Overwritten on every run. Source = PROD Supabase only.');
  L.push('');
  L.push(`- Run (UTC): ${new Date().toISOString()}`);
  L.push(`- Mode: **${dryRun ? 'dry-run' : (poolSafe ? 'pool-safe' : 'snapshot')}**`);
  L.push('- Outcome: export did not run (source unreachable / precondition not met).');
  L.push('');
  L.push('## Connectivity / precondition blocker');
  L.push('');
  for (const ln of blockerLines) L.push(`- ${ln}`);
  L.push('');
  L.push('## Final status');
  L.push('');
  L.push('```');
  L.push('DATA_EXPORT_FAILED');
  L.push('```');
  L.push('');
  try { writeFileSync(EXPORT_REPORT, L.join('\n'), 'utf8'); console.log(`✓ wrote ${EXPORT_REPORT}`); }
  catch (e) { console.error(`✗ failed to write ${EXPORT_REPORT}: ${e.message}`); }
}

function enforce(validation) {
  if (validation.duplicate_pk_total > 0) {
    console.error(`\n✗ Export validation FAILED: ${validation.duplicate_pk_total} duplicate PK(s) across ${validation.errors.length} table(s).`);
    for (const e of validation.errors) console.error(`    - ${e}`);
    console.error('  Import refuses to proceed on a non-consistent export. Re-export from a frozen PROD or via the REPEATABLE READ snapshot (default).');
    process.exit(8);
  }
  console.log(`${tag('PROD')} status: ${dryRun ? 'DATA_EXPORT_DRY_RUN_OK' : 'DATA_EXPORT_OK'}`);
}

main().catch((e) => fatal(e));
