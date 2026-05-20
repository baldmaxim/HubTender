#!/usr/bin/env node
// 04_export_old — read-only dump of OLD Supabase into EXPORT_DIR/data/*.ndjson.
//
// TWO consistency modes:
//
// 1) DEFAULT (snapshot) — single `REPEATABLE READ READ ONLY` transaction.
//    Cross-table consistency. Best for environments where the export
//    connection has its own pool slot (direct connection, not shared with
//    live frontend traffic).
//
// 2) `--pool-safe-export` — per-table fresh connection, no transaction
//    spanning multiple tables. Used when the only available export path
//    is the Supabase Session Pooler shared with live readers/writers,
//    and a long-held REPEATABLE READ snapshot would saturate the pool.
//    Consistency is guaranteed by the operator's no-writes window
//    (manifest records `consistency_mode = "operator_no_writes_pool_safe"`).
//    Pool-safe mode skips server-side `md5(string_agg(...))` checksums on
//    HEAVY tables (boq_items, boq_items_audit, or any table > 100k rows)
//    — a single aggregate over a wide jsonb table can pin a pool slot for
//    >5 minutes and is what got us blocked in the first place.
//
// Both modes use keyset pagination by PK + post-write NDJSON duplicate-PK
// scan. `duplicate_pk_total > 0` always FAILS the export (exit 8).
//
// Connection hygiene:
//   - application_name = 'old-to-prod-export-snapshot' (default) or
//     'old-to-prod-export-pool-safe' (pool-safe).
//   - In pool-safe: per-table client, `await client.end()` in `finally`,
//     short timeout (10 min/batch), max 1 retry per table on transient
//     error, brief sleep (3 sec) between heavy tables.
//   - Never logs URL — only host type via `redactHostType` (direct / pooler /
//     unknown).

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadDotenv, requireEnv, getClient, redactHostType,
  tag, writeJson, parseCliArgs, fatal, assertTemporalRawParsers,
} from './_lib.mjs';
import { IMPORT_ORDER } from './_tables.mjs';
import {
  streamTableKeyset, writeNdjson, validateNdjsonPks, defaultOrderBy,
} from './_copy.mjs';
import {
  loadAuthUsersForExport, loadIdentitiesForExport, collectAuthStats,
} from './_auth.mjs';
import { sha256OfFile, tableChecksumSql, chunkedTableChecksum, HEAVY_CHECKSUM_CHUNK, JSONB_TABLES } from './_checksums.mjs';
import { CHECKSUM_TABLES, HEAVY_CHECKSUM_SKIP } from './_mapping.mjs';

loadDotenv();

// Snapshot path may run a single 30+ min sql_checksum on the boq_items_audit
// equivalent — bump the client-side pg-node `query_timeout` to 1 hour for
// THIS process unless the operator already requested longer.
if (!process.env.PG_QUERY_TIMEOUT_MS || parseInt(process.env.PG_QUERY_TIMEOUT_MS, 10) < 3_600_000) {
  process.env.PG_QUERY_TIMEOUT_MS = '3600000'; // 60 min
}

const { values } = parseCliArgs({
  name: '04_export_old.mjs',
  description: 'Read-only export of OLD Supabase to EXPORT_DIR/data/*.ndjson.',
  options: {
    'dry-run':    { type: 'boolean', default: false, describe: 'Probe + counts only; do not write NDJSON' },
    'batch-size': { type: 'string',  default: '',    describe: 'Page size for keyset SELECT (default 5000 snapshot mode, 2500 pool-safe mode)' },
    'export-dir': { type: 'string',  default: '',    describe: 'Override EXPORT_DIR env' },
    'use-mcp-preflight': { type: 'boolean', default: false, describe: 'No-op for export; accepted so users can pass the flag uniformly across all stages' },
    'pool-safe-export':  { type: 'boolean', default: false, describe: 'Per-table fresh connection + no long REPEATABLE READ snapshot. Use when OLD pool is shared with live traffic. Requires operator-confirmed no-writes window for cross-table consistency.' },
  },
});

const exportDir = values['export-dir'] || process.env.EXPORT_DIR || './.old-to-prod-export';
const poolSafe = values['pool-safe-export'];
const defaultBatch = poolSafe ? 2500 : 5000;
const batchSize = parseInt(values['batch-size'], 10) || defaultBatch;
const dryRun = values['dry-run'];

// Sleep helper for inter-table pacing in pool-safe mode.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Heavy-table classifier — skip server-side md5 checksum in pool-safe mode
// (or when explicitly listed). Snapshot mode still skips HEAVY_CHECKSUM_SKIP
// but allows other tables; pool-safe additionally skips by row_count threshold.
function shouldSkipServerChecksum(table, rowCount, mode) {
  if (HEAVY_CHECKSUM_SKIP.has(table)) return true;
  if (mode === 'pool-safe' && rowCount > 100_000) return true;
  return false;
}

async function main() {
  const exportUrl = process.env.OLD_SUPABASE_EXPORT_DB_URL?.trim() || requireEnv('OLD_SUPABASE_DB_URL');
  const usingExportOverride = !!process.env.OLD_SUPABASE_EXPORT_DB_URL?.trim();
  const hostType = redactHostType(exportUrl);
  mkdirSync(join(exportDir, 'data'), { recursive: true });

  const mode = poolSafe ? 'pool-safe' : 'snapshot';
  const appName = poolSafe ? 'old-to-prod-export-pool-safe' : 'old-to-prod-export-snapshot';

  console.log(
    `${tag('OLD')} export mode: ${mode}` +
    `${usingExportOverride ? ' (via OLD_SUPABASE_EXPORT_DB_URL)' : ''}` +
    `, host type: ${hostType}, batch=${batchSize}`,
  );
  if (poolSafe && hostType === 'pooler') {
    console.log(`${tag('OLD')} ⚠ pool-safe mode on a pooler URL — per-table connection ok, but a direct connection (db.<ref>.supabase.co) is preferred when available.`);
  }

  if (mode === 'pool-safe') {
    return runPoolSafeExport({ url: exportUrl, appName, hostType });
  }
  return runSnapshotExport({ url: exportUrl, appName, hostType });
}

// ---------------------------------------------------------------------------
// SNAPSHOT MODE (default) — one long REPEATABLE READ transaction.
// ---------------------------------------------------------------------------

async function runSnapshotExport({ url, appName, hostType }) {
  console.log(`${tag('OLD')} connecting (snapshot mode)…`);
  const client = await getClient(url, { applicationName: appName });

  const validation = {
    generated_at: null,
    snapshot_mode: 'repeatable_read',
    consistency_mode: 'repeatable_read_snapshot',
    pool_safe_export: false,
    transaction_snapshot: true,
    operator_confirmed_no_writes_required: false,
    snapshot_started_at: null,
    snapshot_committed_at: null,
    temporal_parser_check: null,
    tables: [],
    duplicate_pk_total: 0,
    errors: [],
    warnings: [],
  };

  let snapshotOpen = false;
  try {
    validation.snapshot_started_at = new Date().toISOString();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    snapshotOpen = true;
    await client.query(`SET LOCAL statement_timeout = 0`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = 0`);
    console.log(`${tag('OLD')} snapshot opened (REPEATABLE READ READ ONLY, statement_timeout=0) at ${validation.snapshot_started_at}`);

    const { rows: [v] } = await client.query('SELECT version() AS v');
    console.log(`${tag('OLD')} ${v.v.slice(0, 40)}…`);

    validation.temporal_parser_check = await assertTemporalRawParsers(client);
    console.log(`${tag('OLD')} temporal raw-parser check ✓ (date/timestamp/timestamptz as raw text, µs preserved, UTC)`);

    const manifest = mkManifest({
      sourceVersion: v.v,
      mode: 'snapshot',
      snapshotStartedAt: validation.snapshot_started_at,
    });

    const checksumSet = new Set(CHECKSUM_TABLES);

    for (const table of IMPORT_ORDER) {
      const entry = await exportPublicTable({
        client, table, batchSize, checksumSet, dryRun, mode: 'snapshot',
      });
      if (entry.skipped) {
        manifest.warnings.push(`public.${table}: not present in OLD, skipped`);
        console.log(`${tag('OLD')} skip public.${table} (not present)`);
        continue;
      }
      ingestTableValidation(validation, `public.${table}`, entry.valid);
      pushManifestPublic(manifest, table, entry);
      logPublic(entry);
    }

    const authResult = await exportAuth({
      client, batchSize, dryRun, mode: 'snapshot',
    });
    for (const a of authResult.entries) {
      ingestTableValidation(validation, a.table, a.valid);
      pushManifestAuth(manifest, a);
    }
    for (const line of authResult.logLines) console.log(line);

    // ---- tender_registry baseline duplicates ----
    try {
      const { rows: [r] } = await client.query(`
        SELECT
          (SELECT COUNT(*)::int FROM (
              SELECT tender_number FROM public.tender_registry
               WHERE tender_number IS NOT NULL
               GROUP BY tender_number HAVING COUNT(*) > 1
           ) t) AS by_tender_number,
          (SELECT COUNT(*)::int FROM (
              SELECT title, client_name, area FROM public.tender_registry
               WHERE tender_number IS NULL
               GROUP BY title, client_name, area HAVING COUNT(*) > 1
           ) t) AS by_title_client_area
      `);
      manifest.tender_registry_duplicates = {
        by_tender_number: r.by_tender_number,
        by_title_client_area: r.by_title_client_area,
      };
      console.log(
        `${tag('OLD')} tender_registry duplicates baseline: ` +
        `by_tender_number=${r.by_tender_number} by_title_client_area=${r.by_title_client_area}`,
      );
    } catch (e) {
      manifest.warnings.push(`tender_registry duplicate baseline failed: ${e.message}`);
    }

    const stats = await collectAuthStats(client);

    await client.query('COMMIT');
    snapshotOpen = false;
    validation.snapshot_committed_at = new Date().toISOString();
    manifest.snapshot_committed_at = validation.snapshot_committed_at;
    console.log(`${tag('OLD')} snapshot committed at ${validation.snapshot_committed_at}`);

    finalizeAndWrite({ manifest, validation, stats, dryRun });
    logAuthStats(stats);
    enforceValidation(validation);
  } catch (e) {
    if (snapshotOpen) {
      try { await client.query('ROLLBACK'); } catch {}
      console.error(`${tag('OLD')} snapshot rolled back due to error.`);
    }
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// POOL-SAFE MODE — per-table fresh client, no long snapshot.
// ---------------------------------------------------------------------------

async function runPoolSafeExport({ url, appName, hostType }) {
  console.log(`${tag('OLD')} pool-safe mode: one connection per table, no global transaction.`);
  console.log(`${tag('OLD')} ⚠ cross-table consistency depends on operator's no-writes window. RUNBOOK §10.B forbids this mode for production cutover without explicit freeze.`);

  // Per-batch timeout — 10 minutes is comfortable for a 2500-row keyset SELECT
  // on a wide table. Crucially much less than 60 min: a wedged SELECT will
  // surface here, not hold a pool slot for an hour.
  const perCallOpts = {
    applicationName: appName,
    timeoutMs: 10 * 60_000,
  };

  const validation = {
    generated_at: null,
    snapshot_mode: 'none',
    consistency_mode: 'operator_no_writes_pool_safe',
    pool_safe_export: true,
    transaction_snapshot: false,
    operator_confirmed_no_writes_required: true,
    snapshot_started_at: null,
    snapshot_committed_at: null,
    temporal_parser_check: null,
    tables: [],
    duplicate_pk_total: 0,
    errors: [],
    warnings: [
      'Pool-safe export skips REPEATABLE READ snapshot. Cross-table consistency relies on operator-confirmed write-freeze of OLD. Production cutover MUST NOT use this mode without explicit freeze.',
    ],
  };

  const manifest = mkManifest({ sourceVersion: null, mode: 'pool-safe', snapshotStartedAt: null });

  // Probe version with a fresh, short-lived client.
  {
    const probe = await getClient(url, perCallOpts);
    try {
      const { rows: [v] } = await probe.query('SELECT version() AS v');
      manifest.source_db_version = v.v;
      console.log(`${tag('OLD')} ${v.v.slice(0, 40)}…`);
      validation.temporal_parser_check = await assertTemporalRawParsers(probe);
      console.log(`${tag('OLD')} temporal raw-parser check ✓ (date/timestamp/timestamptz as raw text, µs preserved, UTC)`);
    } finally {
      await probe.end().catch(() => {});
    }
  }

  const checksumSet = new Set(CHECKSUM_TABLES);

  for (const table of IMPORT_ORDER) {
    let attempt = 0;
    let entry;
    while (true) {
      const client = await getClient(url, perCallOpts);
      try {
        entry = await exportPublicTable({
          client, table, batchSize, checksumSet, dryRun, mode: 'pool-safe',
        });
        break;
      } catch (e) {
        attempt++;
        await client.end().catch(() => {});
        if (attempt > 1) {
          console.error(`${tag('OLD')} ✗ public.${table} failed after 1 retry: ${e.message}`);
          throw e;
        }
        console.warn(`${tag('OLD')} ⚠ public.${table} attempt 1 failed: ${e.message}. Retrying after 5s with new connection…`);
        await sleep(5000);
        continue;
      } finally {
        await client.end().catch(() => {});
      }
    }
    if (entry.skipped) {
      manifest.warnings.push(`public.${table}: not present in OLD, skipped`);
      console.log(`${tag('OLD')} skip public.${table} (not present)`);
      continue;
    }
    ingestTableValidation(validation, `public.${table}`, entry.valid);
    pushManifestPublic(manifest, table, entry);
    logPublic(entry);
    // Pace heavy tables — give Supavisor a moment to recycle the slot.
    if (HEAVY_CHECKSUM_SKIP.has(table)) {
      await sleep(3000);
    }
  }

  // Auth phase — fresh client per auth table.
  {
    const client = await getClient(url, perCallOpts);
    try {
      const authResult = await exportAuth({
        client, batchSize, dryRun, mode: 'pool-safe',
      });
      for (const a of authResult.entries) {
        ingestTableValidation(validation, a.table, a.valid);
        pushManifestAuth(manifest, a);
      }
      for (const line of authResult.logLines) console.log(line);
    } finally {
      await client.end().catch(() => {});
    }
  }

  // tender_registry baseline duplicates — fresh client.
  {
    const client = await getClient(url, perCallOpts);
    try {
      const { rows: [r] } = await client.query(`
        SELECT
          (SELECT COUNT(*)::int FROM (
              SELECT tender_number FROM public.tender_registry
               WHERE tender_number IS NOT NULL
               GROUP BY tender_number HAVING COUNT(*) > 1
           ) t) AS by_tender_number,
          (SELECT COUNT(*)::int FROM (
              SELECT title, client_name, area FROM public.tender_registry
               WHERE tender_number IS NULL
               GROUP BY title, client_name, area HAVING COUNT(*) > 1
           ) t) AS by_title_client_area
      `);
      manifest.tender_registry_duplicates = {
        by_tender_number: r.by_tender_number,
        by_title_client_area: r.by_title_client_area,
      };
      console.log(
        `${tag('OLD')} tender_registry duplicates baseline: ` +
        `by_tender_number=${r.by_tender_number} by_title_client_area=${r.by_title_client_area}`,
      );
    } catch (e) {
      manifest.warnings.push(`tender_registry duplicate baseline failed: ${e.message}`);
    } finally {
      await client.end().catch(() => {});
    }
  }

  // Auth stats — fresh client.
  let stats;
  {
    const client = await getClient(url, perCallOpts);
    try {
      stats = await collectAuthStats(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  finalizeAndWrite({ manifest, validation, stats, dryRun });
  logAuthStats(stats);
  enforceValidation(validation);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function mkManifest({ sourceVersion, mode, snapshotStartedAt }) {
  return {
    generated_at: new Date().toISOString(),
    source_db_version: sourceVersion,
    source_label: 'OLD',
    export_format: 'NDJSON',
    dry_run: dryRun,
    snapshot_mode: mode === 'snapshot' ? 'repeatable_read' : 'none',
    consistency_mode: mode === 'snapshot' ? 'repeatable_read_snapshot' : 'operator_no_writes_pool_safe',
    pool_safe_export: mode === 'pool-safe',
    transaction_snapshot: mode === 'snapshot',
    operator_confirmed_no_writes_required: mode === 'pool-safe',
    temporal_raw_parsers: true,
    session_time_zone: 'UTC',
    date_style: 'ISO, MDY',
    snapshot_started_at: snapshotStartedAt,
    snapshot_committed_at: null,
    tables: [],
    row_counts: {},
    warnings: [
      'auth.sessions and auth.refresh_tokens are intentionally NOT exported. ' +
      'They are tied to the OLD project\'s instance_id and JWT secret. After cutover ' +
      'all users will be force-relogged in via a new PROD session.',
    ],
  };
}

async function exportPublicTable({ client, table, batchSize, checksumSet, dryRun, mode }) {
  const exists = await tableExists(client, 'public', table);
  if (!exists) return { skipped: true, table };

  const { rows: [c] } = await client.query(`SELECT COUNT(*)::int AS n FROM "public"."${table}"`);
  const rowCount = c.n;
  const pkColumn = defaultOrderBy(table);
  const ndjsonPath = join(exportDir, 'data', `public.${table}.ndjson`);
  let bytes = 0;
  if (!dryRun && rowCount > 0) {
    const stream = streamTableKeyset(client, { schema: 'public', table, pkColumn, batchSize });
    const r = await writeNdjson(ndjsonPath, stream);
    bytes = r.bytes;
  }
  const checksum = dryRun || rowCount === 0 ? null : await sha256OfFile(ndjsonPath);

  // Heavy tables (HEAVY_CHECKSUM_SKIP / pool-safe >100k) are NO LONGER
  // skipped — they get a chunked, deterministic checksum (bounded per query)
  // so strict cutover can reach VERIFY_OK without manual exclusions.
  let sqlChecksum = null;
  let sqlChecksumMode = null;
  let sqlChecksumChunk = null;
  if (!dryRun && rowCount > 0 && checksumSet.has(table)) {
    const heavy = shouldSkipServerChecksum(table, rowCount, mode);
    if (heavy) {
      sqlChecksumChunk = HEAVY_CHECKSUM_CHUNK;
      sqlChecksum = await chunkedTableChecksum(client, {
        schema: 'public', table, orderBy: pkColumn, chunkSize: sqlChecksumChunk,
      });
      sqlChecksumMode = 'chunked';
    } else {
      const { rows: [r] } = await client.query(tableChecksumSql('public', table, pkColumn));
      sqlChecksum = r?.checksum ?? null;
      sqlChecksumMode = 'full';
    }
  }

  let valid = { total: 0, distinct: 0, duplicates: 0, sample_duplicate_pks: [] };
  if (!dryRun && rowCount > 0) {
    valid = await validateNdjsonPks(ndjsonPath, pkColumn);
  }

  return {
    skipped: false,
    schema: 'public',
    table,
    rowCount,
    pkColumn,
    bytes,
    ndjsonPath: dryRun ? null : `data/public.${table}.ndjson`,
    checksum,
    sqlChecksum,
    sqlChecksumMode,
    sqlChecksumChunk,
    has_jsonb: JSONB_TABLES.has(table),
    valid,
    mode,
  };
}

function pushManifestPublic(manifest, table, e) {
  manifest.row_counts[`public.${table}`] = e.rowCount;
  manifest.tables.push({
    schema: 'public',
    table,
    rows: e.rowCount,
    row_count: e.rowCount,
    distinct_pk_count: e.valid?.distinct ?? null,
    duplicate_pk_count: e.valid?.duplicates ?? 0,
    ndjson_bytes: e.bytes,
    ndjson_path: e.ndjsonPath,
    checksum_sha256: e.checksum,
    sql_checksum: e.sqlChecksum,
    sql_checksum_mode: e.sqlChecksumMode,           // 'full' | 'chunked' | null
    sql_checksum_chunk_size: e.sqlChecksumChunk,    // chunk size when 'chunked'
    sql_checksum_skipped_reason: null,              // heavy tables now chunked, not skipped
    has_jsonb: e.has_jsonb,
    pk_column: e.pkColumn,
  });
}

function logPublic(e) {
  const csTag = e.sqlChecksum
    ? (e.sqlChecksumMode === 'chunked' ? ' [sql-cs ✓ chunked]' : ' [sql-cs ✓]')
    : '';
  const dupTag = (e.valid?.duplicates ?? 0) > 0 ? ` ⚠ dup_pk=${e.valid.duplicates}` : '';
  console.log(`${tag('OLD')} ${e.rowCount.toString().padStart(8)} public.${e.table}${dryRun ? ' (dry-run)' : ''}${csTag}${dupTag}`);
}

async function exportAuth({ client, batchSize, dryRun, mode }) {
  const entries = [];
  const logLines = [];
  const authUsersPath = join(exportDir, 'data', 'auth.users.ndjson');
  const authIdentitiesPath = join(exportDir, 'data', 'auth.identities.ndjson');

  if (await tableExists(client, 'auth', 'users')) {
    const { rows: [c] } = await client.query(`SELECT COUNT(*)::int AS n FROM auth.users`);
    const rowCount = c.n;
    let bytes = 0;
    if (!dryRun && rowCount > 0) {
      const r = await writeNdjson(authUsersPath, loadAuthUsersForExport(client, { batchSize }));
      bytes = r.bytes;
    }
    let valid = { total: 0, distinct: 0, duplicates: 0, sample_duplicate_pks: [] };
    if (!dryRun && rowCount > 0) valid = await validateNdjsonPks(authUsersPath, 'id');
    entries.push({
      table: 'auth.users',
      schema: 'auth', tableName: 'users',
      rowCount, bytes,
      ndjsonPath: dryRun ? null : 'data/auth.users.ndjson',
      checksum: dryRun || rowCount === 0 ? null : await sha256OfFile(authUsersPath),
      valid,
      note: 'encrypted_password preserved byte-to-byte; never printed in any log',
    });
    const dupTag = valid.duplicates > 0 ? ` ⚠ dup_pk=${valid.duplicates}` : '';
    logLines.push(`${tag('OLD')} ${rowCount.toString().padStart(8)} auth.users${dryRun ? ' (dry-run)' : ''}${dupTag}`);
  }

  if (await tableExists(client, 'auth', 'identities')) {
    const { rows: [c] } = await client.query(`SELECT COUNT(*)::int AS n FROM auth.identities`);
    const rowCount = c.n;
    let bytes = 0;
    if (!dryRun && rowCount > 0) {
      const r = await writeNdjson(authIdentitiesPath, loadIdentitiesForExport(client, { batchSize }));
      bytes = r.bytes;
    }
    let valid = { total: 0, distinct: 0, duplicates: 0, sample_duplicate_pks: [] };
    if (!dryRun && rowCount > 0) valid = await validateNdjsonPks(authIdentitiesPath, 'id');
    entries.push({
      table: 'auth.identities',
      schema: 'auth', tableName: 'identities',
      rowCount, bytes,
      ndjsonPath: dryRun ? null : 'data/auth.identities.ndjson',
      checksum: dryRun || rowCount === 0 ? null : await sha256OfFile(authIdentitiesPath),
      valid,
    });
    const dupTag = valid.duplicates > 0 ? ` ⚠ dup_pk=${valid.duplicates}` : '';
    logLines.push(`${tag('OLD')} ${rowCount.toString().padStart(8)} auth.identities${dryRun ? ' (dry-run)' : ''}${dupTag}`);
  }

  return { entries, logLines };
}

function pushManifestAuth(manifest, a) {
  manifest.row_counts[a.table] = a.rowCount;
  manifest.tables.push({
    schema: a.schema,
    table: a.tableName,
    rows: a.rowCount,
    row_count: a.rowCount,
    distinct_pk_count: a.valid?.distinct ?? null,
    duplicate_pk_count: a.valid?.duplicates ?? 0,
    ndjson_bytes: a.bytes,
    ndjson_path: a.ndjsonPath,
    checksum_sha256: a.checksum,
    pk_column: 'id',
    note: a.note,
  });
}

function ingestTableValidation(validation, tableName, valid) {
  if (!valid) return;
  validation.tables.push({
    table: tableName,
    ndjson_lines: valid.total,
    distinct_pk_count: valid.distinct,
    duplicate_pk_count: valid.duplicates,
    sample_duplicate_pks: valid.sample_duplicate_pks,
  });
  validation.duplicate_pk_total += valid.duplicates;
  if (valid.duplicates > 0) {
    validation.errors.push(
      `${tableName}: ${valid.duplicates} duplicate PK(s) detected in NDJSON — export inconsistent.`,
    );
  }
}

function finalizeAndWrite({ manifest, validation, stats, dryRun }) {
  validation.generated_at = new Date().toISOString();
  if (!dryRun) {
    writeJson(join(exportDir, 'auth_stats.json'), {
      generated_at: new Date().toISOString(),
      source_label: 'OLD',
      ...stats,
    });
    writeJson(join(exportDir, 'export_validation.json'), validation);
    writeJson(join(exportDir, 'manifest.json'), manifest);
    console.log(`✓ wrote ${join(exportDir, 'manifest.json')}`);
    console.log(`✓ wrote ${join(exportDir, 'export_validation.json')}`);
  } else {
    console.log(`✓ dry-run complete (${manifest.tables.length} tables surveyed)`);
  }
}

function logAuthStats(stats) {
  console.log(
    `${tag('OLD')} auth_stats: users=${stats.auth_users_count} ` +
    `with_pw=${stats.users_with_encrypted_password} ` +
    `oauth_only=${stats.oauth_only_users_count} ` +
    `orphans=${stats.orphan_auth_users}/${stats.orphan_public_users} ` +
    `dup_emails=${stats.duplicate_emails_in_auth.length}`
  );
}

function enforceValidation(validation) {
  if (validation.duplicate_pk_total > 0) {
    console.error(`\n✗ Export validation FAILED: ${validation.duplicate_pk_total} duplicate PK(s) across ${validation.errors.length} table(s).`);
    for (const e of validation.errors) console.error(`    - ${e}`);
    console.error(`  See ${join(exportDir, 'export_validation.json')} for full details. Import refuses to proceed on a non-consistent export.`);
    process.exit(8);
  }
}

async function tableExists(client, schema, table) {
  const { rows } = await client.query(`SELECT to_regclass($1) AS reg`, [`${schema}.${table}`]);
  return rows[0]?.reg !== null;
}

main().catch((e) => fatal(e));
