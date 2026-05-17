#!/usr/bin/env node
// 04_import_yandex — controlled import of the PROD Supabase NDJSON dump into
// the Yandex Managed PostgreSQL target.
//
// =============================== SAFETY ====================================
//  - Imports ONLY from EXPORT_DIR produced by 03 (manifest.source_label must
//    be PROD_SUPABASE). OLD_SUPABASE_DB_URL forbidden (assertNoOldEnv, exit 7).
//  - Requires the Yandex schema verify doc 09 to read SCHEMA_VERIFY_OK, else
//    refuses (run `npm run prod-to-yandex:verify-schema` first).
//  - Yandex connection = STRICT TLS verify-full + raw parsers + UTC/ISO.
//  - Precheck: every target public app table + auth.users(+identities) is 0
//    rows. Non-empty → refuse (unless --clean-yandex + --confirm +
//    ALLOW_CLEAN_YANDEX=true performs an explicit-list DELETE first).
//  - Real import ONLY when ALLOW_DATA_IMPORT=true AND not --dry-run.
//  - Auth import ONLY when ALLOW_AUTH_IMPORT=true.
//  - encrypted_password preserved byte-for-byte (no rehash, never logged).
//  - Import triggers (boq_items audit / tender_registry auto-create / notify)
//    disabled DURING bulk import ONLY if ALLOW_DISABLE_IMPORT_TRIGGERS=true,
//    via ALTER TABLE ... DISABLE TRIGGER <name>, re-enabled in finally. NEVER
//    session_replication_role; NEVER system triggers. Triggers stay in the
//    final schema.
//  - NEVER --allow-overwrite / ALLOW_PROD_OVERWRITE — not supported here.
//  - CLEAN-ONLY (variant B): --clean-only + --clean-yandex + --confirm +
//    ALLOW_CLEAN_YANDEX=true performs a DATA-ONLY clean of partial-import rows
//    and NEVER imports. It runs a STRUCTURE-only precheck (row counts ignored)
//    and does NOT require manifest / SCHEMA_VERIFY_OK / ALLOW_DATA_IMPORT /
//    ALLOW_AUTH_IMPORT / ALLOW_DISABLE_IMPORT_TRIGGERS. Explicit-list DELETE in
//    reverse FK order (auth last); NO DROP/TRUNCATE CASCADE/session_replication_
//    role/system-trigger disable. Normal import path stays strict & unchanged.
//  - Exit codes: 0 ok · 2 config/precondition · 3 blocker · 7 guard · 1 fail.
// ===========================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadEnv, env, requireEnv, getExportDir, getYandexClient, resolveCa,
  tag, writeJson, parseCliArgs, requireExportFiles, twoKeyGuard, fatal,
  assertNoOldEnv, assertTemporalRawParsers, loadDocFinalStatus, DOC_DIR,
} from './_lib.mjs';
import {
  IMPORT_ORDER, AUTH_IMPORT_ORDER, REQUIRES_TRIGGER_DISABLE,
  NOTIFY_TRIGGERS_BY_TABLE, SELF_FK_TABLES, defaultOrderBy,
  EXPECTED_ENUMS, PGNOTIFY_TABLES, SUPABASE_INTERNAL_SCHEMAS,
  CLEAN_SIDE_EFFECT_TRIGGERS,
} from './_tables.mjs';
import {
  readNdjson, batchInsert, withTempDisabledTriggers, discoverTriggers,
  topoSortBySelfFK, countRows, tableExists,
} from './_copy.mjs';
import {
  AUTH_USERS_PROJECTION, AUTH_IDENTITIES_PROJECTION, AUTH_USERS_NOT_NULL_TOKENS,
  listInsertableColumns,
} from './_auth.mjs';

loadEnv();

const IMPORT_REPORT = join(DOC_DIR, '12_DATA_IMPORT_REPORT.md');

const { values } = parseCliArgs({
  name: '04_import_yandex.mjs',
  description: 'Import the PROD Supabase NDJSON dump into Yandex. Two-key safety on destructive ops.',
  options: {
    'dry-run':       { type: 'boolean', default: false, describe: 'No Yandex writes; plan only' },
    'auth-only':     { type: 'boolean', default: false, describe: 'Import auth.users + auth.identities only' },
    'public-only':   { type: 'boolean', default: false, describe: 'Skip auth schema entirely' },
    'resume':        { type: 'boolean', default: false, describe: 'Resume from EXPORT_DIR/yandex_import_state.json (ON CONFLICT DO NOTHING for completed tables)' },
    'clean-yandex':  { type: 'boolean', default: false, describe: 'DELETE listed target tables (REQUIRES ALLOW_CLEAN_YANDEX=true + --confirm)' },
    'clean-only':    { type: 'boolean', default: false, describe: 'Data-only clean of partial-import rows; NO import. Needs --clean-yandex --confirm + ALLOW_CLEAN_YANDEX=true. Structure-only precheck; ignores SCHEMA_VERIFY/manifest/import gates.' },
    'confirm':       { type: 'boolean', default: false, describe: 'Required for --clean-yandex' },
    'batch-size':    { type: 'string',  default: '1000', describe: 'Rows per INSERT batch' },
    'export-dir':    { type: 'string',  default: '',     describe: 'Override EXPORT_DIR env' },
  },
});

const exportDir = values['export-dir'] || env('EXPORT_DIR') || getExportDir();
const batchSize = parseInt(values['batch-size'], 10) || 1000;
const dryRun = values['dry-run'];
const resume = values.resume === true;
const cleanOnly = values['clean-only'] === true;

// Populated once per import run by discoverTendersUpdatedAtRisk(): table →
// [user trigger names] that would mutate public.tenders.updated_at during bulk
// import. Merged into the per-table disable set in importPublicTable().
let dynamicTendersRiskByTable = {};

// Dynamically discover USER triggers (tgisinternal=false) whose function calls
// recalculate_tender_grand_total() / UPDATEs public.tenders, plus the
// public.tenders handle_updated_at trigger. These re-stamp tenders.updated_at
// during bulk import. Returns { tableName: [triggerName, ...] }.
async function discoverTendersUpdatedAtRisk(client) {
  const { rows } = await client.query(`
    SELECT c.relname AS tbl, t.tgname AS trg
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND n.nspname = 'public'
       AND (
         p.prosrc ILIKE '%recalculate_tender_grand_total%'
         OR p.prosrc ILIKE '%update%public.tenders%'
         OR pg_get_triggerdef(t.oid) ILIKE '%recalculate_tender_grand_total%'
         OR (c.relname = 'tenders' AND p.proname = 'handle_updated_at')
       )`);
  const map = {};
  for (const r of rows) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(r.trg)) continue;
    (map[r.tbl] ||= []).push(r.trg);
  }
  return map;
}

const allowDataImport = env('ALLOW_DATA_IMPORT') === 'true';
const allowAuthImport = env('ALLOW_AUTH_IMPORT') === 'true';
const allowCleanYandex = env('ALLOW_CLEAN_YANDEX') === 'true';
const allowDisableTriggers = env('ALLOW_DISABLE_IMPORT_TRIGGERS') === 'true';

async function main() {
  // ---- Hard OLD-env guard ----
  try { assertNoOldEnv(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(7); }

  // ---- Variant B: dedicated CLEAN-ONLY mode (no import) ----
  // Removes residual partial-import rows when SCHEMA_VERIFY_OK is unreachable
  // *only because* tables are non-empty. Validates schema STRUCTURE (not row
  // emptiness); does NOT require manifest / SCHEMA_VERIFY_OK / ALLOW_DATA_IMPORT
  // / ALLOW_AUTH_IMPORT / ALLOW_DISABLE_IMPORT_TRIGGERS. Never imports.
  if (cleanOnly) { await runCleanOnly(); return; }

  // ---- Required export artefacts ----
  requireExportFiles(exportDir, ['manifest.json', 'export_validation.json'],
    'Run `npm run prod-to-yandex:export` first.');

  const manifest = JSON.parse(readFileSync(join(exportDir, 'manifest.json'), 'utf8'));
  if (manifest.source_label !== 'PROD_SUPABASE') {
    console.error(`✗ manifest.source_label=${manifest.source_label}; expected PROD_SUPABASE.`);
    console.error('  This importer only consumes a PROD Supabase export. Re-run :export.');
    process.exit(2);
  }
  const validation = JSON.parse(readFileSync(join(exportDir, 'export_validation.json'), 'utf8'));
  if ((validation.duplicate_pk_total ?? 0) > 0) {
    console.error(`✗ export_validation.json reports ${validation.duplicate_pk_total} duplicate PK(s). Refusing to import an inconsistent export.`);
    process.exit(3);
  }
  if (manifest.dry_run === true) {
    console.error('✗ manifest.json is from a --dry-run export (no NDJSON written). Re-run :export WITHOUT --dry-run.');
    process.exit(2);
  }

  // ---- Yandex schema must be verified OK ----
  const schemaVerify = loadDocFinalStatus('09_SCHEMA_VERIFY_RESULT.md', /SCHEMA_VERIFY_(OK_WITH_WARNINGS|OK|FAILED)/);
  if (!schemaVerify.found || schemaVerify.status !== 'SCHEMA_VERIFY_OK') {
    console.error(`✗ docs/yandex-migration/09_SCHEMA_VERIFY_RESULT.md final status = ${schemaVerify.status ?? '(missing)'}; expected SCHEMA_VERIFY_OK.`);
    console.error('  Run `npm run prod-to-yandex:verify-schema` and resolve blockers before importing data.');
    process.exit(3);
  }

  // ---- Safety gates ----
  try {
    twoKeyGuard({ cliFlag: values['clean-yandex'], envVar: 'ALLOW_CLEAN_YANDEX', label: 'Clean Yandex' });
  } catch (e) { console.error(`✗ ${e.message}`); process.exit(7); }
  if (values['clean-yandex'] && !values.confirm) {
    console.error('✗ --clean-yandex is destructive. Re-run with --confirm to acknowledge.');
    process.exit(7);
  }

  const importAuth = !values['public-only'];
  if (importAuth && !allowAuthImport && !dryRun) {
    console.error('✗ Auth import requires ALLOW_AUTH_IMPORT=true in scripts/prod-to-yandex/.env.prod-to-yandex.');
    console.error('  Or pass --public-only to skip the auth schema, or --dry-run to plan only.');
    process.exit(7);
  }
  if (!dryRun && !allowDataImport) {
    console.error('✗ Real import requires ALLOW_DATA_IMPORT=true in scripts/prod-to-yandex/.env.prod-to-yandex.');
    console.error('  Pass --dry-run to plan without writing to Yandex.');
    process.exit(7);
  }

  // ---- Yandex connection (verify-full + raw parsers + UTC/ISO) ----
  const yaUrl = (() => {
    try { return requireEnv('YANDEX_DATABASE_URL'); }
    catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }
  })();
  const ca = resolveCa();
  if (!ca.ok) {
    console.error(`✗ Yandex CA unavailable (${ca.reason}); verify-full required — refusing.`);
    process.exit(2);
  }

  const report = {
    started_at: new Date().toISOString(),
    finished_at: null,
    dry_run: dryRun,
    options: { ...values, allowDataImport, allowAuthImport, allowCleanYandex, allowDisableTriggers },
    precheck: null,
    audit_fk_compat: null,
    tenders_updated_at_protection: null,
    clean_yandex: null,
    auth: null,
    per_table: [],
    disabled_triggers: [],
    status: 'PENDING',
  };

  // State for --resume.
  const statePath = join(exportDir, 'yandex_import_state.json');
  let state;
  if (resume && existsSync(statePath)) {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } else {
    state = { started_at: report.started_at, completed: [], errors: [], disabled_triggers: [] };
  }

  console.log(`${tag('YA')} connecting (verify-full)${dryRun ? ' (dry-run)' : ''}…`);
  const client = await getYandexClient(yaUrl, ca.pem, { applicationName: 'prod-to-yandex-import' });

  try {
    const temporal = await assertTemporalRawParsers(client);
    console.log(`${tag('YA')} raw-parser self-check ✓ (tstz=${temporal.timestamptz}, UTC/ISO)`);

    // ---- Audit FK compatibility (fail early) ----
    // boq_items_audit is historical/audit storage; an enforced FK on
    // boq_item_id → boq_items rejects legitimate DELETE-history rows. PROD has
    // no such FK. If the (spurious) FK still exists on the applied Yandex
    // schema, refuse BEFORE importing — run the schema repair first.
    {
      const { rows: afk } = await client.query(`
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_class rc ON rc.oid = con.confrelid
         WHERE n.nspname='public' AND c.relname='boq_items_audit'
           AND con.contype='f' AND rc.relname='boq_items'
           AND 'boq_item_id' = ANY (
                 SELECT a.attname FROM unnest(con.conkey) k
                   JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k)`);
      if (afk.length > 0) {
        const names = afk.map((r) => r.conname).join(', ');
        report.audit_fk_compat = { ok: false, constraints: afk.map((r) => r.conname) };
        report.finished_at = new Date().toISOString();
        report.status = 'DATA_IMPORT_FAILED';
        report.error = `boq_items_audit FK on boq_item_id still present (${names}); run schema repair before import: npm run prod-to-yandex:repair-audit-fk -- --apply (gated). See docs/yandex-migration/15_AUDIT_FK_SCHEMA_DECISION.md`;
        writeReportMd(report);
        console.error(`✗ ${names} exists; run schema repair before import`);
        console.error('  npm run prod-to-yandex:repair-audit-fk -- --dry-run   (then --apply, gated)');
        await client.end().catch(() => {});
        process.exit(3);
      }
      report.audit_fk_compat = { ok: true, constraints: [] };
      console.log(`${tag('YA')} audit FK compatibility ✓ (no enforced boq_items_audit.boq_item_id FK)`);
    }

    // ---- Root-cause: dynamically find user triggers that would mutate
    // public.tenders.updated_at during a bulk import (grand-total recalc →
    // UPDATE public.tenders → handle_updated_at). Augments the static
    // REQUIRES_TRIGGER_DISABLE map so future imports keep tenders.updated_at
    // byte-stable vs the PROD export. User triggers only (tgisinternal=false);
    // never DISABLE TRIGGER ALL / system triggers / session_replication_role.
    dynamicTendersRiskByTable = await discoverTendersUpdatedAtRisk(client);
    report.tenders_updated_at_protection = dynamicTendersRiskByTable;
    const riskPairs = Object.entries(dynamicTendersRiskByTable)
      .flatMap(([t, ts]) => ts.map((x) => `public.${t}.${x}`));
    console.log(`${tag('YA')} tenders.updated_at-risk user triggers: ${riskPairs.length ? riskPairs.join(', ') : '(none)'}`
      + ` — disabled per-table during import (re-enabled in finally)`);

    // ---- Existing tables on the target ----
    const { rows: pubRows } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    );
    const presentPublic = new Set(pubRows.map((r) => r.table_name));
    const hasAuthUsers = await tableExists(client, 'auth', 'users');
    const hasAuthIdentities = await tableExists(client, 'auth', 'identities');

    // ---- Emptiness precheck ----
    const precheck = { public: {}, auth: {}, non_empty: [] };
    for (const t of IMPORT_ORDER) {
      if (!presentPublic.has(t)) continue;
      const n = await countRows(client, 'public', t);
      precheck.public[t] = n;
      if (n !== 0) precheck.non_empty.push(`public.${t}=${n}`);
    }
    if (hasAuthUsers) {
      const n = await countRows(client, 'auth', 'users');
      precheck.auth['users'] = n;
      if (n !== 0) precheck.non_empty.push(`auth.users=${n}`);
    }
    if (hasAuthIdentities) {
      const n = await countRows(client, 'auth', 'identities');
      precheck.auth['identities'] = n;
      if (n !== 0) precheck.non_empty.push(`auth.identities=${n}`);
    }
    report.precheck = precheck;
    console.log(`${tag('YA')} emptiness precheck: ${precheck.non_empty.length === 0 ? 'all target tables 0 rows ✓' : 'NON-EMPTY: ' + precheck.non_empty.join(', ')}`);

    const cleanRequested = values['clean-yandex'] && values.confirm && allowCleanYandex;
    if (precheck.non_empty.length > 0 && !cleanRequested && !resume) {
      console.error('✗ Yandex target is not empty. Refusing to import onto non-empty tables.');
      console.error(`  Non-empty: ${precheck.non_empty.join(', ')}`);
      console.error('  Resolve: --clean-yandex --confirm + ALLOW_CLEAN_YANDEX=true, or --resume.');
      report.status = 'DATA_IMPORT_FAILED';
      writeReportMd(report);
      await client.end().catch(() => {});
      process.exit(3);
    }

    // ---- Destructive clean (explicit list, reverse import order, no CASCADE) ----
    if (values['clean-yandex'] && values.confirm) {
      const order = [];
      for (const t of [...IMPORT_ORDER].reverse()) if (presentPublic.has(t)) order.push({ schema: 'public', table: t });
      if (hasAuthIdentities) order.push({ schema: 'auth', table: 'identities' });
      if (hasAuthUsers) order.push({ schema: 'auth', table: 'users' });
      const cy = { executed: false, dry_run: dryRun, order: order.map((o) => `${o.schema}.${o.table}`), deleted: {} };
      console.log(`${tag('YA')} clean-yandex plan (${order.length} tables, reverse FK order, no CASCADE)${dryRun ? ' (dry-run)' : ''}`);
      if (!dryRun && allowCleanYandex) {
        for (const o of order) {
          const r = await client.query(`DELETE FROM "${o.schema}"."${o.table}"`);
          cy.deleted[`${o.schema}.${o.table}`] = r.rowCount ?? 0;
        }
        for (const o of order) {
          const n = await countRows(client, o.schema, o.table);
          if (n !== 0) throw new Error(`clean-yandex post-assert failed: ${o.schema}.${o.table} still has ${n} rows.`);
        }
        cy.executed = true;
        console.log(`${tag('YA')} ✓ clean-yandex deleted from ${order.length} tables`);
      } else if (!allowCleanYandex) {
        console.error('✗ --clean-yandex requires ALLOW_CLEAN_YANDEX=true.');
        process.exit(7);
      }
      report.clean_yandex = cy;
    }

    // ---- Auth phase ----
    if (importAuth && !values['public-only']) {
      report.auth = await importAuthPhase(client, manifest, state, statePath);
      saveState(statePath, state);
    }

    // ---- Public phase ----
    if (!values['auth-only']) {
      for (const table of IMPORT_ORDER) {
        if (!presentPublic.has(table)) { console.log(`${tag('YA')} skip public.${table} (not on target)`); continue; }
        if (state.completed.includes(`public.${table}`)) { console.log(`${tag('YA')} skip public.${table} (already completed)`); continue; }
        const entry = (manifest.tables ?? []).find((t) => t.schema === 'public' && t.table === table);
        if (!entry || entry.rows === 0) { state.completed.push(`public.${table}`); continue; }
        const tr = await importPublicTable(client, entry, state);
        report.per_table.push(tr);
        saveState(statePath, state);
      }
    }

    report.disabled_triggers = state.disabled_triggers;
    report.finished_at = new Date().toISOString();
    report.status = dryRun ? 'DATA_IMPORT_DRY_RUN_OK' : 'DATA_IMPORT_OK';
    writeReportMd(report);
    console.log(`${tag('YA')} status: ${report.status}`);
  } catch (e) {
    report.finished_at = new Date().toISOString();
    report.status = 'DATA_IMPORT_FAILED';
    report.error = String(e?.message || e).replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-conn>');
    writeReportMd(report);
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------

async function importAuthPhase(client, manifest, state, statePath) {
  const result = { auth_users: null, auth_identities: null, policy: resume ? 'RESUME_DO_NOTHING' : 'FAIL_BY_DEFAULT' };
  const usersPath = join(exportDir, 'data', 'auth.users.ndjson');
  const identPath = join(exportDir, 'data', 'auth.identities.ndjson');
  const policy = resume ? 'RESUME_DO_NOTHING' : 'FAIL_BY_DEFAULT';

  if (existsSync(usersPath) && !state.completed.includes('auth.users')) {
    // Coerce NOT-NULL token columns NULL → '' (bridge DEFAULT '' parity).
    // encrypted_password is passed through untouched (byte-for-byte).
    let inserted = 0, skipped = 0;
    let buffer = [];
    const cols = AUTH_USERS_PROJECTION.slice();
    const flush = async (rows) => {
      if (rows.length === 0 || dryRun) return { inserted: 0, skipped: rows.length };
      return batchInsert(client, { schema: 'auth', table: 'users', columns: cols, rows, policy, auth: true });
    };
    for await (const row of readNdjson(usersPath)) {
      const norm = { ...row };
      for (const c of AUTH_USERS_NOT_NULL_TOKENS) {
        if (norm[c] === null || norm[c] === undefined) norm[c] = '';
      }
      buffer.push(norm);
      if (buffer.length >= batchSize) {
        const r = await flush(buffer); inserted += r.inserted; skipped += r.skipped; buffer = [];
      }
    }
    if (buffer.length) { const r = await flush(buffer); inserted += r.inserted; skipped += r.skipped; }
    result.auth_users = { inserted, skipped, policy };
    state.completed.push('auth.users');
    console.log(`${tag('YA')} auth.users: policy=${policy} inserted=${inserted} skipped=${skipped}${dryRun ? ' (dry-run)' : ''}`);
    saveState(statePath, state);
  }

  if (existsSync(identPath) && !state.completed.includes('auth.identities')) {
    // email is GENERATED ALWAYS on the Yandex bridge — never insert it.
    const colInfo = dryRun
      ? { insertable: AUTH_IDENTITIES_PROJECTION, skipped: [] }
      : await listInsertableColumns(client, 'auth', 'identities');
    const insertableSet = new Set(colInfo.insertable);
    const cols = AUTH_IDENTITIES_PROJECTION.filter((c) => insertableSet.has(c));
    const skippedCols = colInfo.skipped.filter((s) => AUTH_IDENTITIES_PROJECTION.includes(s.name));
    if (skippedCols.length) {
      state.auth_identities_skipped_columns = skippedCols;
      console.log(`${tag('YA')} auth.identities: skipping non-insertable column(s): ${skippedCols.map((s) => `${s.name}(${s.reason})`).join(', ')}`);
    }
    let inserted = 0, skipped = 0;
    let buffer = [];
    const flush = async (rows) => {
      if (rows.length === 0 || dryRun) return { inserted: 0, skipped: rows.length };
      return batchInsert(client, { schema: 'auth', table: 'identities', columns: cols, rows, policy, auth: true });
    };
    for await (const row of readNdjson(identPath)) {
      buffer.push(row);
      if (buffer.length >= batchSize) { const r = await flush(buffer); inserted += r.inserted; skipped += r.skipped; buffer = []; }
    }
    if (buffer.length) { const r = await flush(buffer); inserted += r.inserted; skipped += r.skipped; }
    result.auth_identities = { inserted, skipped, policy };
    state.completed.push('auth.identities');
    console.log(`${tag('YA')} auth.identities: policy=${policy} inserted=${inserted} skipped=${skipped}${dryRun ? ' (dry-run)' : ''}`);
    saveState(statePath, state);
  }
  return result;
}

async function importPublicTable(client, entry, state) {
  const path = join(exportDir, entry.ndjson_path);
  if (!existsSync(path)) {
    console.error(`✗ missing ${path}; skipping public.${entry.table}`);
    return { table: entry.table, error: 'missing-ndjson' };
  }

  // Column set from the first row.
  let firstRow = null;
  for await (const r of readNdjson(path)) { firstRow = r; break; }
  if (!firstRow) { state.completed.push(`public.${entry.table}`); return { table: entry.table, inserted: 0, skipped: 0 }; }
  const columns = Object.keys(firstRow);
  const policy = resume ? 'RESUME_DO_NOTHING' : 'FAIL_BY_DEFAULT';

  // Triggers to disable DURING this table's bulk import (only those that
  // actually exist on the target; only when ALLOW_DISABLE_IMPORT_TRIGGERS=true).
  const candidateTriggers = [...new Set([
    ...(REQUIRES_TRIGGER_DISABLE[entry.table] || []),
    ...(NOTIFY_TRIGGERS_BY_TABLE[entry.table] || []),
    // Root-cause fix: dynamically discovered triggers that would re-stamp
    // public.tenders.updated_at (grand-total recalc) during this table's import.
    ...(dynamicTendersRiskByTable[entry.table] || []),
  ])];
  let triggers = [];
  if (candidateTriggers.length && !dryRun) {
    const present = await discoverTriggers(client, 'public', entry.table, candidateTriggers);
    if (present.length) {
      if (!allowDisableTriggers) {
        console.error(
          `✗ public.${entry.table}: target has trigger(s) [${present.join(', ')}] that duplicate/notify ` +
          `during bulk import. Set ALLOW_DISABLE_IMPORT_TRIGGERS=true to disable them for the import ` +
          `window (re-enabled in finally). They stay in the final schema.`,
        );
        throw new Error('requires_trigger_disable');
      }
      triggers = present;
    }
  }

  const doImport = async () => {
    let inserted = 0, skipped = 0;
    const flushOne = async (rows) => {
      if (dryRun) return { inserted: 0, skipped: rows.length };
      return batchInsert(client, { schema: 'public', table: entry.table, columns, rows, policy });
    };

    const selfFk = SELF_FK_TABLES[entry.table];
    if (selfFk) {
      const all = [];
      for await (const row of readNdjson(path)) all.push(row);
      const sorted = topoSortBySelfFK(all, selfFk.idCol, selfFk.parentCol);
      for (let i = 0; i < sorted.length; i += batchSize) {
        const r = await flushOne(sorted.slice(i, i + batchSize));
        inserted += r.inserted; skipped += r.skipped;
      }
      return { inserted, skipped };
    }

    let buffer = [];
    for await (const row of readNdjson(path)) {
      buffer.push(row);
      if (buffer.length >= batchSize) { const r = await flushOne(buffer); inserted += r.inserted; skipped += r.skipped; buffer = []; }
    }
    if (buffer.length) { const r = await flushOne(buffer); inserted += r.inserted; skipped += r.skipped; }
    return { inserted, skipped };
  };

  let result;
  if (triggers.length && allowDisableTriggers && !dryRun) {
    state.disabled_triggers.push({ table: entry.table, triggers });
    result = await withTempDisabledTriggers(client, { schema: 'public', table: entry.table, triggerNames: triggers }, doImport);
  } else {
    result = await doImport();
  }

  state.completed.push(`public.${entry.table}`);
  console.log(
    `${tag('YA')} public.${entry.table}: policy=${policy} inserted=${result.inserted} skipped=${result.skipped}` +
    `${triggers.length ? ` (triggers disabled: ${triggers.join(', ')})` : ''}${dryRun ? ' (dry-run)' : ''}`,
  );
  return { table: entry.table, policy, disabled_triggers: triggers, ...result };
}

function saveState(path, state) {
  if (dryRun) return;
  writeJson(path, state);
}

function writeReportMd(report) {
  mkdirSync(DOC_DIR, { recursive: true });
  const L = [];
  L.push('# 12. DATA IMPORT REPORT');
  L.push('');
  L.push('> Generated by `scripts/prod-to-yandex/04_import_yandex.mjs`.');
  L.push('> Overwritten on every run. Source = PROD Supabase export only.');
  L.push('');
  L.push(`- Started (UTC): ${report.started_at}`);
  L.push(`- Finished (UTC): ${report.finished_at || '(in progress / failed)'}`);
  L.push(`- Dry-run: ${report.dry_run ? 'YES' : 'no'}`);
  L.push('');
  L.push('## Options');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(report.options, null, 2));
  L.push('```');
  L.push('');
  L.push('## Audit FK compatibility');
  L.push('');
  if (report.audit_fk_compat) {
    L.push(report.audit_fk_compat.ok
      ? '- OK — no enforced FK on `boq_items_audit.boq_item_id` (audit/history compatible). '
        + 'See docs/yandex-migration/15_AUDIT_FK_SCHEMA_DECISION.md.'
      : `- ❌ enforced FK present: ${report.audit_fk_compat.constraints.join(', ')} — `
        + 'import refused. Run `npm run prod-to-yandex:repair-audit-fk -- --apply` (gated) first.');
  } else { L.push('_not checked_'); }
  L.push('');
  L.push('## Emptiness precheck');
  L.push('');
  if (report.precheck) {
    L.push(report.precheck.non_empty.length === 0
      ? '- all target public + auth tables were empty (0 rows) — OK'
      : `- NON-EMPTY before import: ${report.precheck.non_empty.join(', ')}`);
  } else { L.push('_not run_'); }
  L.push('');
  L.push('## Clean-yandex');
  L.push('');
  if (report.clean_yandex) {
    L.push(`- executed: ${report.clean_yandex.executed ? 'YES' : 'NO (dry-run / not allowed)'}`);
    L.push(`- order: ${report.clean_yandex.order.join(' → ')}`);
  } else { L.push('Not requested.'); }
  L.push('');
  L.push('## Auth phase');
  L.push('');
  L.push(report.auth ? '```json\n' + JSON.stringify(report.auth, null, 2) + '\n```' : 'Skipped (--public-only / ALLOW_AUTH_IMPORT=false).');
  L.push('');
  L.push('## Public tables');
  L.push('');
  L.push('| Table | Policy | Inserted | Skipped | Triggers disabled | Error |');
  L.push('|---|---|---:|---:|---|---|');
  for (const t of report.per_table) {
    L.push(`| ${t.table} | ${t.policy ?? '-'} | ${t.inserted ?? '-'} | ${t.skipped ?? '-'} | ${(t.disabled_triggers || []).join(', ') || '—'} | ${t.error ?? ''} |`);
  }
  L.push('');
  L.push('## tenders.updated_at side-effect protection (root-cause fix)');
  L.push('');
  L.push('> Dynamically discovered user triggers (tgisinternal=false) that call '
    + '`recalculate_tender_grand_total()` / UPDATE `public.tenders` / are the '
    + 'tenders `handle_updated_at` trigger. Disabled per-table during bulk '
    + 'import so `tenders.updated_at` stays byte-stable vs the PROD export. '
    + 'Re-enabled in finally; kept in the final schema. See '
    + 'docs/yandex-migration/17_TENDERS_UPDATED_AT_REPAIR_RESULT.md.');
  const tp = report.tenders_updated_at_protection;
  if (tp && Object.keys(tp).length) {
    for (const [t, ts] of Object.entries(tp)) L.push(`- public.${t}: ${ts.join(', ')}`);
  } else { L.push('- _(none discovered)_'); }
  L.push('');
  L.push('## Triggers disabled during import (re-enabled in finally; kept in final schema)');
  L.push('');
  if ((report.disabled_triggers || []).length) {
    for (const d of report.disabled_triggers) L.push(`- public.${d.table}: ${d.triggers.join(', ')}`);
  } else { L.push('_none_'); }
  if (report.error) { L.push(''); L.push('## Error'); L.push(''); L.push(`- ❌ ${report.error}`); }
  L.push('');
  L.push('## Final status');
  L.push('');
  L.push('```');
  L.push(report.status);
  L.push('```');
  L.push('');
  try { writeFileSync(IMPORT_REPORT, L.join('\n'), 'utf8'); console.log(`✓ wrote ${IMPORT_REPORT}`); }
  catch (e) { console.error(`✗ failed to write ${IMPORT_REPORT}: ${e.message}`); }
}

// ===========================================================================
// CLEAN-ONLY MODE (variant B): data-only clean of partial-import rows.
// ===========================================================================

const CLEAN_STATUS = {
  DRY: 'DATA_CLEAN_DRY_RUN_OK',
  OK: 'DATA_CLEAN_OK',
  FAILED: 'DATA_CLEAN_FAILED',
};

// Structure-only precheck: schema must be structurally correct EVEN IF tables
// are non-empty. Row counts are intentionally NOT checked here.
async function structureOnlyPrecheck(client) {
  const q = async (sql, p) => (await client.query(sql, p)).rows;
  const items = [];
  const add = (name, ok, detail) => items.push({ name, ok: !!ok, detail: detail || '' });

  const ns = (await q(
    "SELECT nspname FROM pg_namespace WHERE nspname IN ('public','auth')")).map((r) => r.nspname);
  add('schema public exists', ns.includes('public'));
  add('schema auth exists', ns.includes('auth'));

  const hasAuthUsers = (await q("SELECT to_regclass('auth.users') AS r"))[0].r != null;
  const hasAuthIdentities = (await q("SELECT to_regclass('auth.identities') AS r"))[0].r != null;
  const authUid = (await q(
    "SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid " +
    "WHERE n.nspname='auth' AND p.proname='uid') AS e"))[0].e;
  add('auth.users exists', hasAuthUsers);
  add('auth.identities exists', hasAuthIdentities, hasAuthIdentities ? '' : 'optional bridge — required by schema foundation');
  add('auth.uid() exists', authUid);

  const dbTables = new Set((await q(
    "SELECT table_name FROM information_schema.tables " +
    "WHERE table_schema='public' AND table_type='BASE TABLE'")).map((r) => r.table_name));
  const missingTables = IMPORT_ORDER.filter((t) => !dbTables.has(t));
  add(`expected ${IMPORT_ORDER.length} public tables exist`, missingTables.length === 0,
    missingTables.length ? `missing: ${missingTables.join(', ')}` : '');

  const dbEnums = new Set((await q(
    "SELECT t.typname FROM pg_type t JOIN pg_namespace n ON t.typnamespace=n.oid " +
    "WHERE n.nspname='public' AND t.typtype='e'")).map((r) => r.typname));
  const missingEnums = EXPECTED_ENUMS.filter((e) => !dbEnums.has(e));
  add(`expected ${EXPECTED_ENUMS.length} enums exist`, missingEnums.length === 0,
    missingEnums.length ? `missing: ${missingEnums.join(', ')}` : '');

  const notifyFn = (await q(
    "SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid " +
    "WHERE n.nspname='public' AND p.proname='notify_row_change') AS e"))[0].e;
  add('public.notify_row_change() exists', notifyFn);

  const ntTables = new Set((await q(
    "SELECT event_object_table AS t FROM information_schema.triggers " +
    "WHERE trigger_schema='public' AND trigger_name LIKE 'trg_notify_row_change%'")).map((r) => r.t));
  const missingNotify = PGNOTIFY_TABLES.filter((t) => !ntTables.has(t));
  add('pg_notify rowchange triggers on 6 tables', missingNotify.length === 0,
    missingNotify.length ? `missing on: ${missingNotify.join(', ')}` : '');

  const exts = new Set((await q('SELECT extname FROM pg_extension')).map((r) => r.extname));
  add('extension pgcrypto', exts.has('pgcrypto'));
  add('extension uuid-ossp', exts.has('uuid-ossp'));

  const sbPresent = (await q(
    'SELECT nspname FROM pg_namespace WHERE nspname = ANY($1)',
    [SUPABASE_INTERNAL_SCHEMAS])).map((r) => r.nspname);
  add('Supabase internal schemas absent', sbPresent.length === 0,
    sbPresent.length ? `present: ${sbPresent.join(', ')}` : '');

  const auditFk = (await q(`
    SELECT con.conname FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class rc ON rc.oid=con.confrelid
     WHERE n.nspname='public' AND c.relname='boq_items_audit'
       AND con.contype='f' AND rc.relname='boq_items'
       AND 'boq_item_id' = ANY (
             SELECT a.attname FROM unnest(con.conkey) k
               JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k)`))
    .map((r) => r.conname);
  add('no enforced boq_items_audit.boq_item_id FK', auditFk.length === 0,
    auditFk.length ? `present: ${auditFk.join(', ')}` : '');
  const auditIdx = (await q(
    "SELECT 1 FROM pg_indexes WHERE schemaname='public' " +
    "AND tablename='boq_items_audit' AND indexname='idx_boq_items_audit_boq_item_id'")).length > 0;
  add('idx_boq_items_audit_boq_item_id exists', auditIdx);

  return { ok: items.every((i) => i.ok), items, hasAuthUsers, hasAuthIdentities };
}

async function runCleanOnly() {
  const report = {
    mode: 'clean-only',
    started_at: new Date().toISOString(),
    finished_at: null,
    dry_run: dryRun,
    options: { ...values, allowCleanYandex, allowDisableTriggers },
    structure: null,
    clean_plan: null,
    trigger_protection: {
      reason: 'prevent synthetic boq_items_audit rows (trg_boq_items_audit on '
        + 'boq_items DELETE) and a pg_notify rowchange storm during cleanup',
      planned: [], disabled: [], reenabled: [],
    },
    rows_before: {},
    rows_after: {},
    errors: [],
    status: 'PENDING',
  };

  // ---- Guard: clean-only needs --clean-only + --clean-yandex + --confirm
  // always; ALLOW_CLEAN_YANDEX=true is the destructive key — required for the
  // REAL clean, not for a no-write dry-run plan. ----
  const missing = [];
  if (!values['clean-only']) missing.push('--clean-only');
  if (!values['clean-yandex']) missing.push('--clean-yandex');
  if (!values.confirm) missing.push('--confirm');
  if (!dryRun && !allowCleanYandex) missing.push('ALLOW_CLEAN_YANDEX=true (real clean)');
  if (missing.length) {
    report.errors.push(`clean-only refused — missing: ${missing.join(', ')}`);
    report.finished_at = new Date().toISOString();
    report.status = CLEAN_STATUS.FAILED;
    writeCleanReportMd(report);
    console.error('✗ clean-only refused. Need --clean-only --clean-yandex --confirm'
      + ' (+ ALLOW_CLEAN_YANDEX=true for the real, non-dry-run clean).');
    console.error(`  missing: ${missing.join(', ')}`);
    process.exit(7);
  }

  const yaUrl = (() => {
    try { return requireEnv('YANDEX_DATABASE_URL'); }
    catch (e) { report.errors.push(e.message); report.status = CLEAN_STATUS.FAILED; writeCleanReportMd(report); console.error(`✗ ${e.message}`); process.exit(2); }
  })();
  const ca = resolveCa();
  if (!ca.ok) {
    report.errors.push(`Yandex CA unavailable (${ca.reason})`);
    report.status = CLEAN_STATUS.FAILED; writeCleanReportMd(report);
    console.error(`✗ Yandex CA unavailable (${ca.reason}); verify-full required.`);
    process.exit(2);
  }

  console.log(`${tag('YA')} CLEAN-ONLY ${dryRun ? '(dry-run — no writes)' : '(REAL clean)'} — no import will run`);
  const client = await getYandexClient(yaUrl, ca.pem, { applicationName: 'prod-to-yandex-clean-only' });

  try {
    // ---- Structure-only precheck ----
    const st = await structureOnlyPrecheck(client);
    report.structure = st;
    for (const it of st.items) console.log(`${tag('YA')} ${it.ok ? '✓' : '✗'} ${it.name}${it.detail ? ' — ' + it.detail : ''}`);
    if (!st.ok) {
      report.errors.push('structure-only precheck FAILED — refusing to clean (schema not structurally valid).');
      report.finished_at = new Date().toISOString();
      report.status = CLEAN_STATUS.FAILED;
      writeCleanReportMd(report);
      console.error('✗ DATA_CLEAN_FAILED — structure precheck failed; nothing cleaned.');
      await client.end().catch(() => {});
      process.exit(3);
    }

    // ---- Existing tables + clean order (reverse import order; auth last) ----
    const present = new Set((await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    )).rows.map((r) => r.table_name));
    const order = [];
    for (const t of [...IMPORT_ORDER].reverse()) if (present.has(t)) order.push({ schema: 'public', table: t });
    if (st.hasAuthIdentities) order.push({ schema: 'auth', table: 'identities' });
    if (st.hasAuthUsers) order.push({ schema: 'auth', table: 'users' });

    let totalBefore = 0;
    const nonEmpty = [];
    for (const o of order) {
      const n = await countRows(client, o.schema, o.table);
      report.rows_before[`${o.schema}.${o.table}`] = n;
      totalBefore += n;
      if (n !== 0) nonEmpty.push(`${o.schema}.${o.table}=${n}`);
    }
    report.clean_plan = {
      reverse_import_order: order.map((o) => `${o.schema}.${o.table}`),
      method: 'DELETE FROM explicit table (reverse FK order, NO CASCADE, NO session_replication_role)',
      tables: order.length,
      non_empty: nonEmpty,
      total_rows_before: totalBefore,
    };
    console.log(`${tag('YA')} clean plan: ${order.length} tables, ${nonEmpty.length} non-empty, ${totalBefore} rows total`);
    nonEmpty.forEach((x) => console.log(`${tag('YA')}   ${x}`));

    // ---- Discover side-effect USER triggers to disable during the clean ----
    // Exact schema.table + exact trigger name; discoverTriggers filters
    // tgisinternal=false (user triggers only). Never DISABLE TRIGGER ALL,
    // never system triggers, never session_replication_role.
    const planned = [];
    for (const o of order) {
      if (o.schema !== 'public') continue;
      const cand = CLEAN_SIDE_EFFECT_TRIGGERS[o.table];
      if (!cand || !cand.length) continue;
      const present = await discoverTriggers(client, 'public', o.table, cand);
      if (present.length) planned.push({ schema: 'public', table: o.table, triggers: present });
    }
    report.trigger_protection.planned = planned.map((p) => ({ table: `${p.schema}.${p.table}`, triggers: p.triggers }));
    if (planned.length) {
      console.log(`${tag('YA')} side-effect triggers planned for temporary disable:`);
      for (const p of planned) console.log(`${tag('YA')}   public.${p.table}: ${p.triggers.join(', ')}`);
    } else {
      console.log(`${tag('YA')} no side-effect triggers present to disable`);
    }

    if (dryRun) {
      report.finished_at = new Date().toISOString();
      report.status = CLEAN_STATUS.DRY;
      writeCleanReportMd(report);
      console.log(`${tag('YA')} status: ${CLEAN_STATUS.DRY} (nothing written to Yandex; no triggers touched)`);
      await client.end().catch(() => {});
      return;
    }

    // ---- Real clean: trigger-disable gate ----
    if (planned.length > 0 && !allowDisableTriggers) {
      report.errors.push(
        'clean-only would generate synthetic audit rows (trg_boq_items_audit) '
        + 'and a NOTIFY storm unless the listed user triggers are disabled. '
        + 'Real clean with trigger disable requires ALLOW_DISABLE_IMPORT_TRIGGERS=true '
        + '(plus ALLOW_CLEAN_YANDEX=true + --clean-yandex --clean-only --confirm).');
      report.finished_at = new Date().toISOString();
      report.status = CLEAN_STATUS.FAILED;
      writeCleanReportMd(report);
      console.error('✗ DATA_CLEAN_FAILED — ALLOW_DISABLE_IMPORT_TRIGGERS=true required to disable side-effect triggers; nothing cleaned.');
      await client.end().catch(() => {});
      process.exit(7);
    }

    // ---- Real clean: disable side-effect triggers, DELETE, re-enable in finally ----
    const disabledList = []; // { schema, table, trigger } actually disabled
    try {
      for (const p of planned) {
        for (const trg of p.triggers) {
          await client.query(`ALTER TABLE "${p.schema}"."${p.table}" DISABLE TRIGGER "${trg}"`);
          disabledList.push({ schema: p.schema, table: p.table, trigger: trg });
          console.log(`${tag('YA')} disabled trigger ${p.schema}.${p.table}.${trg}`);
        }
      }
      report.trigger_protection.disabled = disabledList.map((d) => `${d.schema}.${d.table}.${d.trigger}`);

      for (const o of order) {
        const r = await client.query(`DELETE FROM "${o.schema}"."${o.table}"`);
        report.rows_after[`${o.schema}.${o.table}`] = 0;
        console.log(`${tag('YA')} cleaned ${o.schema}.${o.table} (${r.rowCount ?? 0} rows deleted)`);
      }
      let postFail = null;
      for (const o of order) {
        const n = await countRows(client, o.schema, o.table);
        report.rows_after[`${o.schema}.${o.table}`] = n;
        if (n !== 0) postFail = `${o.schema}.${o.table} still has ${n} rows`;
      }
      // Explicit boq_items_audit post-assert (the table the side-effect hit).
      const auditN = await countRows(client, 'public', 'boq_items_audit');
      report.rows_after['public.boq_items_audit'] = auditN;
      if (!postFail && auditN !== 0) postFail = `public.boq_items_audit still has ${auditN} rows`;

      if (postFail) {
        report.errors.push(`post-assert failed: ${postFail}`);
        report.finished_at = new Date().toISOString();
        report.status = CLEAN_STATUS.FAILED;
        console.error(`✗ DATA_CLEAN_FAILED — ${postFail}`);
        // report written in finally (after re-enable) so the doc reflects truth
      } else {
        report.finished_at = new Date().toISOString();
        report.status = CLEAN_STATUS.OK;
        console.log(`${tag('YA')} status: ${CLEAN_STATUS.OK} — ${order.length} tables cleaned (data only; schema untouched)`);
      }
    } finally {
      // Re-enable EXACTLY the triggers we disabled, even on error.
      for (const d of disabledList) {
        try {
          await client.query(`ALTER TABLE "${d.schema}"."${d.table}" ENABLE TRIGGER "${d.trigger}"`);
          report.trigger_protection.reenabled.push(`${d.schema}.${d.table}.${d.trigger}`);
          console.log(`${tag('YA')} re-enabled trigger ${d.schema}.${d.table}.${d.trigger}`);
        } catch (e) {
          report.errors.push(`FAILED to re-enable ${d.schema}.${d.table}.${d.trigger}: ${String(e?.message || e)}`);
          console.error(`✗ FAILED to re-enable ${d.schema}.${d.table}.${d.trigger} — re-enable manually: `
            + `ALTER TABLE "${d.schema}"."${d.table}" ENABLE TRIGGER "${d.trigger}";`);
        }
      }
    }
    writeCleanReportMd(report);
    if (report.status === CLEAN_STATUS.FAILED) { await client.end().catch(() => {}); process.exit(1); }
  } catch (e) {
    report.finished_at = new Date().toISOString();
    report.status = CLEAN_STATUS.FAILED;
    report.errors.push(String(e?.message || e).replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-conn>'));
    writeCleanReportMd(report);
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

function writeCleanReportMd(report) {
  mkdirSync(DOC_DIR, { recursive: true });
  const L = [];
  L.push('# 12. DATA IMPORT REPORT');
  L.push('');
  L.push('> Generated by `scripts/prod-to-yandex/04_import_yandex.mjs`.');
  L.push('> Overwritten on every run. Source = PROD Supabase export only.');
  L.push('');
  L.push(`- Mode: **${report.mode}**`);
  L.push(`- Dry-run: ${report.dry_run ? 'YES' : 'no'}`);
  L.push(`- Started (UTC): ${report.started_at}`);
  L.push(`- Finished (UTC): ${report.finished_at || '(in progress / failed)'}`);
  L.push('');
  L.push('## Options');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(report.options, null, 2));
  L.push('```');
  L.push('');
  L.push('## Clean precheck (structure-only — row counts intentionally ignored)');
  L.push('');
  if (report.structure) {
    L.push('| Check | OK | Detail |');
    L.push('|---|---|---|');
    for (const it of report.structure.items) L.push(`| ${it.name} | ${it.ok ? '✓' : '✗'} | ${String(it.detail).replace(/\|/g, '\\|')} |`);
  } else { L.push('_not run_'); }
  L.push('');
  L.push('## Clean plan');
  L.push('');
  if (report.clean_plan) {
    L.push(`- method: ${report.clean_plan.method}`);
    L.push(`- tables: ${report.clean_plan.tables} (reverse import order; auth after public)`);
    L.push(`- reverse import order: ${report.clean_plan.reverse_import_order.join(' → ')}`);
    L.push(`- non-empty before: ${report.clean_plan.non_empty.length ? report.clean_plan.non_empty.join(', ') : '(none)'}`);
    L.push(`- total rows before: ${report.clean_plan.total_rows_before}`);
  } else { L.push('_not computed_'); }
  L.push('');
  L.push('## Clean-only trigger side-effect protection');
  L.push('');
  const tp = report.trigger_protection;
  if (tp) {
    L.push(`- reason: ${tp.reason}`);
    L.push(`- triggers planned for disable: ${tp.planned.length
      ? tp.planned.map((p) => `${p.table} [${p.triggers.join(', ')}]`).join('; ') : '(none)'}`);
    L.push(`- triggers actually disabled: ${tp.disabled.length ? tp.disabled.join(', ') : '(none — dry-run / not required)'}`);
    L.push(`- triggers re-enabled: ${tp.reenabled.length ? tp.reenabled.join(', ') : '(none)'}`);
    L.push('- method: ALTER TABLE … DISABLE/ENABLE TRIGGER <exact name> (user triggers '
      + 'only, tgisinternal=false); re-enabled in finally; kept in final schema. '
      + 'NO DISABLE TRIGGER ALL, NO system triggers, NO session_replication_role.');
    L.push('- real-clean gate: ALLOW_DISABLE_IMPORT_TRIGGERS=true required when '
      + 'side-effect triggers are present (plus ALLOW_CLEAN_YANDEX=true + '
      + '--clean-yandex --clean-only --confirm). Dry-run only plans.');
  } else { L.push('_n/a_'); }
  L.push('');
  L.push('## Final row counts after clean');
  L.push('');
  if (!report.dry_run && Object.keys(report.rows_after).length) {
    const nz = Object.entries(report.rows_after).filter(([, v]) => v !== 0);
    L.push(nz.length ? nz.map(([k, v]) => `- ❌ ${k} = ${v} (expected 0)`).join('\n')
      : '- ✓ all cleaned public app tables + auth.users + auth.identities + boq_items_audit = 0');
  } else { L.push('_dry-run — no changes_'); }
  L.push('');
  L.push('## Tables cleaned');
  L.push('');
  const cleanedKeys = Object.keys(report.rows_after);
  if (!report.dry_run && cleanedKeys.length) {
    for (const k of cleanedKeys) L.push(`- ${k}: ${report.rows_before[k] ?? '?'} → ${report.rows_after[k]}`);
  } else { L.push(report.dry_run ? '_dry-run — nothing cleaned_' : '_none_'); }
  L.push('');
  L.push('## Rows before');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(report.rows_before, null, 2));
  L.push('```');
  L.push('');
  L.push('## Rows after');
  L.push('');
  L.push('```json');
  L.push(report.dry_run ? '{}  // dry-run: no changes' : JSON.stringify(report.rows_after, null, 2));
  L.push('```');
  L.push('');
  L.push('## Errors');
  L.push('');
  if (report.errors.length) for (const e of report.errors) L.push(`- ❌ ${e}`);
  else L.push('_none_');
  L.push('');
  L.push('## Final status');
  L.push('');
  L.push('```');
  L.push(report.status);
  L.push('```');
  L.push('');
  L.push('Statuses: `DATA_CLEAN_DRY_RUN_OK` · `DATA_CLEAN_OK` · `DATA_CLEAN_FAILED` · '
    + '`DATA_IMPORT_DRY_RUN_OK` · `DATA_IMPORT_OK` · `DATA_IMPORT_FAILED`');
  L.push('');
  L.push('> After `DATA_CLEAN_OK` run `npm run prod-to-yandex:verify-schema` '
    + '(expected `SCHEMA_VERIFY_OK`). Normal import stays strict (requires '
    + 'SCHEMA_VERIFY_OK + manifest + ALLOW_DATA_IMPORT/ALLOW_AUTH_IMPORT/'
    + 'ALLOW_DISABLE_IMPORT_TRIGGERS).');
  L.push('');
  try { writeFileSync(IMPORT_REPORT, L.join('\n'), 'utf8'); console.log(`✓ wrote ${IMPORT_REPORT}`); }
  catch (e) { console.error(`✗ failed to write ${IMPORT_REPORT}: ${e.message}`); }
}

main().catch((e) => fatal(e));
