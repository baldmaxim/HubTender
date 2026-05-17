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
    'clean-yandex':  { type: 'boolean', default: false, describe: 'DELETE listed target tables before import (REQUIRES ALLOW_CLEAN_YANDEX=true + --confirm)' },
    'confirm':       { type: 'boolean', default: false, describe: 'Required for --clean-yandex' },
    'batch-size':    { type: 'string',  default: '1000', describe: 'Rows per INSERT batch' },
    'export-dir':    { type: 'string',  default: '',     describe: 'Override EXPORT_DIR env' },
  },
});

const exportDir = values['export-dir'] || env('EXPORT_DIR') || getExportDir();
const batchSize = parseInt(values['batch-size'], 10) || 1000;
const dryRun = values['dry-run'];
const resume = values.resume === true;

const allowDataImport = env('ALLOW_DATA_IMPORT') === 'true';
const allowAuthImport = env('ALLOW_AUTH_IMPORT') === 'true';
const allowCleanYandex = env('ALLOW_CLEAN_YANDEX') === 'true';
const allowDisableTriggers = env('ALLOW_DISABLE_IMPORT_TRIGGERS') === 'true';

async function main() {
  // ---- Hard OLD-env guard ----
  try { assertNoOldEnv(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(7); }

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
  const candidateTriggers = [
    ...(REQUIRES_TRIGGER_DISABLE[entry.table] || []),
    ...(NOTIFY_TRIGGERS_BY_TABLE[entry.table] || []),
  ];
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

main().catch((e) => fatal(e));
