#!/usr/bin/env node
// 06_import_prod — controlled import of OLD NDJSON dumps into PROD Supabase.
//
// Safety design:
//  - Every destructive operation requires two keys: CLI flag + env ALLOW_*=true.
//  - Refuses to start without: manifest.json, schema_diff.json (no blockers),
//    prepare_status.json (status READY).
//  - Default conflict policy: ON CONFLICT (pk) DO NOTHING — PROD wins.
//  - Resumable via EXPORT_DIR/import_state.json.
//  - Dangerous triggers (auto_create_tender_registry, log_boq_items_changes)
//    are DISABLED only if ALLOW_DISABLE_IMPORT_TRIGGERS=true, and re-ENABLED
//    in a finally block.
//
// Logs never print: connection strings, anon/service_role keys, passwords,
// encrypted_password, access tokens, refresh tokens, full email addresses.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadDotenv, requireEnv, getClient, tag, writeJson, parseCliArgs,
  requireExportFiles, ensureNoBlockers, twoKeyGuard, fatal, assertMcpPreflightOk,
  assertCleanAuthAllowed,
} from './_lib.mjs';
import { IMPORT_ORDER, REQUIRES_TRIGGER_DISABLE, CLEAN_PROD_PROHIBITED } from './_tables.mjs';
import {
  CONFLICT_POLICY, AUTH_CONFLICT_POLICY, getConflictPolicy, getInsertColumns,
  AUTH_USERS_OVERRIDES, AUTH_USERS_NOT_NULL_TOKENS,
} from './_mapping.mjs';
import { readNdjson, batchInsert, withTempDisabledTriggers, countRows } from './_copy.mjs';
import {
  bootstrapMissingIdentities, getEnabledProviders,
  loadAuthFkGraph, listAuthTables, planAuthCleanup, cleanAuthTarget,
} from './_auth.mjs';

loadDotenv();

const { values } = parseCliArgs({
  name: '06_import_prod.mjs',
  description: 'Import OLD NDJSON exports into PROD Supabase. Two-key safety on destructive ops.',
  options: {
    'dry-run':         { type: 'boolean', default: false, describe: 'No writes; produce import_plan.json only' },
    'auth-only':       { type: 'boolean', default: false, describe: 'Import auth.users + auth.identities only' },
    'public-only':     { type: 'boolean', default: false, describe: 'Skip auth schema entirely' },
    'resume':          { type: 'boolean', default: false, describe: 'Resume from EXPORT_DIR/import_state.json (uses ON CONFLICT DO NOTHING for completed tables)' },
    'clean-prod':      { type: 'boolean', default: false, describe: 'TRUNCATE listed tables before import (REQUIRES ALLOW_CLEAN_PROD=true)' },
    'allow-overwrite': { type: 'boolean', default: false, describe: 'ON CONFLICT DO UPDATE on PK conflicts (REQUIRES ALLOW_PROD_OVERWRITE=true)' },
    'overwrite':       { type: 'boolean', default: false, describe: 'Alias for --allow-overwrite' },
    'batch-size':      { type: 'string',  default: '1000', describe: 'Rows per INSERT batch' },
    'export-dir':      { type: 'string',  default: '',     describe: 'Override EXPORT_DIR env' },
    'confirm':         { type: 'boolean', default: false, describe: 'Required for --clean-prod' },
    'use-mcp-preflight': { type: 'boolean', default: false, describe: 'Trust .old-to-prod-export/schema_diff.json (source=mcp) instead of old_schema/prod_schema files' },
    'clean-auth':      { type: 'boolean', default: false, describe: 'DELETE rows from PROD auth schema before auth import. 3-key guard: --clean-auth + ALLOW_CLEAN_AUTH=true + ALLOW_AUTH_IMPORT=true. Plus auth_collision_analysis.json + MCP_PREFLIGHT not FAILED.' },
  },
});

const exportDir = values['export-dir'] || process.env.EXPORT_DIR || './.old-to-prod-export';
const batchSize = parseInt(values['batch-size'], 10) || 1000;
const dryRun = values['dry-run'];

const allowAuthImport = process.env.ALLOW_AUTH_IMPORT === 'true';
const allowOverwriteEnv = process.env.ALLOW_PROD_OVERWRITE === 'true';
const allowOverwriteCli = values['allow-overwrite'] || values['overwrite'];
const allowOverwrite = allowOverwriteCli && allowOverwriteEnv;
const allowDisableTriggers = process.env.ALLOW_DISABLE_IMPORT_TRIGGERS === 'true';
const forceConfirmEmails = process.env.FORCE_CONFIRM_EMAILS === 'true';
const resume = values.resume === true;
const useMcpPreflight = values['use-mcp-preflight'];
const cleanAuthCli = values['clean-auth'];

async function main() {
  // ---- Preconditions ----
  const requiredFiles = useMcpPreflight
    ? ['schema_diff.json', 'schema_diff.md', 'manifest.json', 'prepare_status.json']
    : ['old_schema.json', 'prod_schema.json', 'schema_diff.json', 'schema_diff.md', 'manifest.json', 'prepare_status.json'];
  const hint = useMcpPreflight
    ? 'Run MCP preflight + :export + :prepare first.'
    : 'Run :introspect-old, :introspect-prod, :compare, :export, :prepare first.';
  requireExportFiles(exportDir, requiredFiles, hint);

  const prodUrl = requireEnv('PROD_SUPABASE_DB_URL');

  if (useMcpPreflight) {
    // Enforces: blockers empty, MCP_PREFLIGHT.md != FAILED. For real (non-dry-run)
    // import, also requires ALLOW_AUTH_IMPORT=true and ALLOW_DISABLE_IMPORT_TRIGGERS=true.
    // Emits a non-fatal warning on MCP_PREFLIGHT_OK_WITH_WARNINGS during real import.
    const mcp = assertMcpPreflightOk({ exportDir, dryRun, enforceImportGates: true });
    console.log(`${tag('PROD')} MCP preflight: ${mcp.status}`);
  } else {
    const schemaDiff = JSON.parse(readFileSync(join(exportDir, 'schema_diff.json'), 'utf8'));
    ensureNoBlockers(schemaDiff);
  }

  const prepareStatus = JSON.parse(readFileSync(join(exportDir, 'prepare_status.json'), 'utf8'));
  if (prepareStatus.status !== 'READY') {
    console.error(`✗ prepare_status.json status=${prepareStatus.status}. Run :prepare and resolve issues first.`);
    process.exit(5);
  }
  // Defense in depth: prepare_status from a --dry-run prepare can only seed a
  // --dry-run import. Real import must be preceded by real :prepare.
  if (prepareStatus.dry_run === true && !dryRun) {
    console.error(`✗ prepare_status.json is from a --dry-run prepare. Real import refuses to consume it.`);
    console.error(`  Re-run \`npm run old-to-prod:prepare -- --use-mcp-preflight ...\` WITHOUT --dry-run before retrying.`);
    process.exit(5);
  }

  const manifest = JSON.parse(readFileSync(join(exportDir, 'manifest.json'), 'utf8'));

  // ---- Safety gates ----
  try {
    twoKeyGuard({ cliFlag: values['clean-prod'], envVar: 'ALLOW_CLEAN_PROD', label: 'Clean PROD' });
    // --allow-overwrite / --overwrite require ALLOW_PROD_OVERWRITE=true.
    if (allowOverwriteCli && !allowOverwriteEnv) {
      throw new Error('--allow-overwrite (or --overwrite) requires ALLOW_PROD_OVERWRITE=true in .env.old-to-prod. Refusing to proceed.');
    }
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(7);
  }

  if (values['clean-prod'] && !values.confirm) {
    console.error('✗ --clean-prod is destructive. Re-run with --confirm to acknowledge.');
    process.exit(7);
  }

  const importAuth = !values['public-only'] && (values['auth-only'] || true);
  if (importAuth && !allowAuthImport) {
    console.error('✗ Auth import requires ALLOW_AUTH_IMPORT=true in .env.old-to-prod.');
    console.error('  Or pass --public-only to skip auth schema.');
    process.exit(7);
  }

  console.log(`${tag('PROD')} conflict policy: ${
    allowOverwrite ? 'OVERWRITE_REQUIRES_TWO_KEY_GUARD' :
    resume ? 'RESUME_DO_NOTHING (per-table, only when previously completed)' :
    'FAIL_BY_DEFAULT + SKIP_IF_IDENTICAL for seed tables'
  }`);

  // ---- Load/init state ----
  const statePath = join(exportDir, 'import_state.json');
  const state = (values.resume && existsSync(statePath))
    ? JSON.parse(readFileSync(statePath, 'utf8'))
    : {
        started_at: new Date().toISOString(),
        completed: [],
        errors: [],
        forced_confirm_emails: [],
        disabled_triggers: [],
      };

  // ---- Connect to PROD ----
  console.log(`${tag('PROD')} connecting${dryRun ? ' (dry-run)' : ''}…`);
  const client = await getClient(prodUrl);

  const report = {
    started_at: state.started_at,
    finished_at: null,
    dry_run: dryRun,
    options: { ...values, allowAuthImport, allowOverwrite, allowDisableTriggers, forceConfirmEmails, cleanAuth: cleanAuthCli },
    per_table: [],
    auth: null,
    clean_auth: null,
  };

  try {
    // ---- Optional cleanup (TWO-KEY guarded above) ----
    if (values['clean-prod']) {
      await cleanProd(client, manifest, state, dryRun);
    }

    // ---- Clean-auth phase (THREE-KEY guarded) ----
    //
    // Runs AFTER public clean (otherwise public.users would still hold an FK
    // to auth.users) and BEFORE auth import. The helper validates every gate
    // and exits with friendly exit codes on policy violation.
    if (cleanAuthCli) {
      // Re-validate the 3-key guard at execution time (independently of
      // whatever 05_prepare_prod logged). assertCleanAuthAllowed exits with a
      // friendly message + non-zero code on any violation.
      assertCleanAuthAllowed({ exportDir, cliFlag: true, dryRun });

      const fkGraph = await loadAuthFkGraph(client);
      const authTables = await listAuthTables(client);
      const plan = planAuthCleanup(fkGraph, authTables);

      // public→auth referrers require --clean-prod --confirm + ALLOW_CLEAN_PROD.
      // We check the same combination 05 logs; 06 enforces it as a hard gate
      // because a stale prepare_status could mask a config change.
      if (plan.public_referrers.length > 0) {
        const allowCleanProd = process.env.ALLOW_CLEAN_PROD === 'true';
        const cleanProdActive = values['clean-prod'] && values.confirm && allowCleanProd;
        if (!cleanProdActive) {
          throw new Error(
            `Cannot clean auth.users while public.users still references auth.users. ` +
            `Use --clean-prod --confirm or resolve manually.`,
          );
        }
      }

      console.log(`${tag('PROD')} clean-auth: ${plan.order.length} table(s) — ${plan.order.map((t) => t.table).join(' → ')}${dryRun ? ' (dry-run, no DELETE)' : ''}`);
      const cleanAuthReport = await cleanAuthTarget(client, plan, { dryRun });
      report.clean_auth = cleanAuthReport;
      // Persist in import_state so 08_verify_auth can surface it in the report.
      state.clean_auth = {
        executed: cleanAuthReport.executed,
        dry_run: cleanAuthReport.dry_run,
        order: cleanAuthReport.plan.order,
        deleted_total: Object.values(cleanAuthReport.deleted).reduce((a, b) => a + b, 0),
      };
      saveState(statePath, state, dryRun);

      if (!dryRun) {
        // Sanity print of before/after — counts only, no PII.
        for (const t of plan.order) {
          const before = cleanAuthReport.before_counts[`${t.schema}.${t.table}`] ?? 0;
          const deleted = cleanAuthReport.deleted[`${t.schema}.${t.table}`] ?? 0;
          const after = cleanAuthReport.after_counts[`${t.schema}.${t.table}`] ?? 0;
          console.log(`${tag('PROD')} ✓ DELETE ${t.schema}.${t.table}: before=${before} deleted=${deleted} after=${after}`);
        }
      }
    }

    // ---- Auth phase ----
    if (importAuth && !values['public-only']) {
      const authResult = await importAuth_(client, state, dryRun, batchSize);
      report.auth = authResult;
      saveState(statePath, state, dryRun);
    }

    if (!values['auth-only']) {
      // ---- Public phase ----
      for (const table of IMPORT_ORDER) {
        if (state.completed.includes(`public.${table}`)) {
          console.log(`${tag('PROD')} skip public.${table} (already completed)`);
          continue;
        }
        const entry = (manifest.tables ?? []).find((t) => t.schema === 'public' && t.table === table);
        if (!entry || entry.rows === 0) {
          state.completed.push(`public.${table}`);
          continue;
        }
        const tableResult = await importPublicTable(client, entry, state, dryRun, batchSize);
        report.per_table.push(tableResult);
        saveState(statePath, state, dryRun);
      }
    }

    report.finished_at = new Date().toISOString();
    writeImportReportMd(report);
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------

async function cleanProd(client, manifest, state, dryRun) {
  const targets = (manifest.tables ?? [])
    .filter((t) => t.schema === 'public' && !CLEAN_PROD_PROHIBITED.has(t.table))
    .map((t) => t.table);
  console.log(`${tag('PROD')} --clean-prod will TRUNCATE these tables:`);
  for (const t of targets) console.log(`    - public.${t}`);
  console.log(`    (seed tables excluded: ${[...CLEAN_PROD_PROHIBITED].join(', ')})`);
  if (dryRun) return;
  // CASCADE not used — explicit list only.
  const sql = `TRUNCATE TABLE ${targets.map((t) => `public.${t}`).join(', ')} RESTART IDENTITY`;
  await client.query(sql);
  state.cleaned_at = new Date().toISOString();
  console.log(`${tag('PROD')} ✓ truncated ${targets.length} tables`);
}

async function importAuth_(client, state, dryRun, batchSize) {
  const ndjsonUsers = join(exportDir, 'data', 'auth.users.ndjson');
  const ndjsonIdent = join(exportDir, 'data', 'auth.identities.ndjson');
  const result = {
    auth_users: null,
    auth_identities: null,
    bootstrap: null,
    auth_policy: resume ? 'AUTH_RESUME_IF_IDENTICAL_ONLY' : 'AUTH_FAIL_BY_DEFAULT',
  };

  if (existsSync(ndjsonUsers) && !state.completed.includes('auth.users')) {
    result.auth_users = await importAuthUsers(client, ndjsonUsers, state, dryRun, batchSize);
    state.completed.push('auth.users');
  }
  if (existsSync(ndjsonIdent) && !state.completed.includes('auth.identities')) {
    result.auth_identities = await importAuthIdentities(client, ndjsonIdent, state, dryRun, batchSize);
    state.completed.push('auth.identities');
  }
  if (!dryRun) {
    const enabledProviders = getEnabledProviders(process.env.PROD_ENABLED_AUTH_PROVIDERS);
    const b = await bootstrapMissingIdentities(client, { enabledProviders });
    result.bootstrap = {
      policy: 'AUTH_BOOTSTRAP_MISSING_IDENTITY_ONLY',
      candidates: b.candidates,
      created: b.created,
      skipped_provider_not_enabled: b.skipped_provider_not_enabled,
      enabled_providers: [...enabledProviders],
    };
    // Track created identity-user-ids for AUTH_VERIFY_RESULT.md provenance.
    state.bootstrapped_identities = b.created_user_ids;
    if (b.created > 0) console.log(`${tag('PROD')} bootstrapped ${b.created} missing email-identities`);
    if (b.skipped_provider_not_enabled) {
      console.log(`${tag('PROD')} ⚠ email provider not in PROD_ENABLED_AUTH_PROVIDERS; identity bootstrap skipped`);
    }
  }
  return result;
}

async function importAuthUsers(client, path, state, dryRun, batchSize) {
  // Buffer rows in pages, then INSERT.
  let inserted = 0, skipped_identical = 0, confirmed = 0;
  const bufferSize = batchSize;
  let buffer = [];

  for await (const row of readNdjson(path)) {
    // Apply overrides (instance_id, aud), NOT-NULL token defaults.
    const norm = { ...row, ...AUTH_USERS_OVERRIDES };
    for (const col of AUTH_USERS_NOT_NULL_TOKENS) {
      if (norm[col] === null || norm[col] === undefined) norm[col] = '';
    }
    // Optional confirm-all override (only applies to fresh INSERTs — never
    // touches existing PROD rows; if --resume sees an existing row with
    // different email_confirmed_at the AUTH_RESUME_IF_IDENTICAL_ONLY policy
    // raises mismatch, which is the right behaviour).
    if (forceConfirmEmails && norm.email_confirmed_at == null && norm.email) {
      norm.email_confirmed_at = new Date().toISOString();
      state.forced_confirm_emails.push(norm.id);
      confirmed++;
    }
    buffer.push(norm);
    if (buffer.length >= bufferSize) {
      const r = await flushAuthUsersBuffer(client, buffer, dryRun);
      inserted += r.inserted;
      skipped_identical += r.skipped_identical ?? 0;
      buffer = [];
    }
  }
  if (buffer.length > 0) {
    const r = await flushAuthUsersBuffer(client, buffer, dryRun);
    inserted += r.inserted;
    skipped_identical += r.skipped_identical ?? 0;
  }
  const policy = resume
    ? 'AUTH_RESUME_IF_IDENTICAL_ONLY'
    : 'AUTH_FAIL_BY_DEFAULT';
  console.log(
    `${tag('PROD')} auth.users: policy=${policy} inserted=${inserted} skipped_identical=${skipped_identical} forced_confirm=${confirmed}`,
  );
  return { inserted, skipped_identical, forced_confirm: confirmed, policy };
}

async function flushAuthUsersBuffer(client, rows, dryRun) {
  const columns = [
    'id', 'email', 'encrypted_password', 'email_confirmed_at',
    'raw_user_meta_data', 'raw_app_meta_data', 'role', 'phone',
    'phone_confirmed_at', 'created_at', 'updated_at', 'last_sign_in_at',
    'banned_until', 'deleted_at', 'is_sso_user', 'is_anonymous',
    'instance_id', 'aud',
    ...AUTH_USERS_NOT_NULL_TOKENS,
  ];
  if (dryRun) return { inserted: 0, skipped: rows.length, skipped_identical: 0, overwritten: 0 };
  // auth.users: AUTH_FAIL_BY_DEFAULT (default) or AUTH_RESUME_IF_IDENTICAL_ONLY
  // (when --resume). NEVER overwrite — ALLOW_PROD_OVERWRITE does not apply
  // here. AUTH_RESUME requires byte-equal row + sha256(encrypted_password)
  // match; any deviation → fail with masked diagnostic.
  const policy = resume
    ? AUTH_CONFLICT_POLICY.AUTH_RESUME_IF_IDENTICAL_ONLY
    : AUTH_CONFLICT_POLICY.AUTH_FAIL_BY_DEFAULT;
  const r = await batchInsert(client, {
    schema: 'auth', table: 'users', columns, rows, policy,
  });
  return {
    inserted: r.inserted,
    skipped_identical: r.skipped_identical ?? 0,
    skipped: rows.length - r.inserted,
  };
}

async function importAuthIdentities(client, path, state, dryRun, batchSize) {
  const columns = [
    'id', 'provider_id', 'user_id', 'identity_data', 'provider',
    'last_sign_in_at', 'created_at', 'updated_at', 'email',
  ];
  let inserted = 0, skipped = 0, skipped_identical = 0;
  let buffer = [];
  // auth.identities: AUTH_FAIL_BY_DEFAULT (default) or AUTH_RESUME_IF_IDENTICAL_ONLY
  // (--resume). NEVER overwrite — same rationale as auth.users.
  const policy = resume
    ? AUTH_CONFLICT_POLICY.AUTH_RESUME_IF_IDENTICAL_ONLY
    : AUTH_CONFLICT_POLICY.AUTH_FAIL_BY_DEFAULT;
  const flush = async (rows) => {
    if (rows.length === 0) return { inserted: 0, skipped_identical: 0 };
    if (dryRun) return { inserted: 0, skipped_identical: 0 };
    return batchInsert(client, {
      schema: 'auth', table: 'identities', columns, rows, policy,
    });
  };
  for await (const row of readNdjson(path)) {
    buffer.push(row);
    if (buffer.length >= batchSize) {
      const r = await flush(buffer);
      inserted += r.inserted;
      skipped_identical += r.skipped_identical ?? 0;
      skipped += buffer.length - r.inserted - (r.skipped_identical ?? 0);
      buffer = [];
    }
  }
  if (buffer.length > 0) {
    const r = await flush(buffer);
    inserted += r.inserted;
    skipped_identical += r.skipped_identical ?? 0;
    skipped += buffer.length - r.inserted - (r.skipped_identical ?? 0);
  }
  console.log(`${tag('PROD')} auth.identities: inserted=${inserted} skipped_identical=${skipped_identical} other_skipped=${skipped} policy=${policy}`);
  return { inserted, skipped_identical, skipped, policy };
}

async function importPublicTable(client, entry, state, dryRun, batchSize) {
  const path = join(exportDir, entry.ndjson_path);
  if (!existsSync(path)) {
    console.error(`✗ missing ${path}; skipping public.${entry.table}`);
    return { table: entry.table, error: 'missing-ndjson' };
  }

  // Determine column set from first row.
  let firstRow = null;
  for await (const r of readNdjson(path)) { firstRow = r; break; }
  if (!firstRow) {
    state.completed.push(`public.${entry.table}`);
    return { table: entry.table, inserted: 0, skipped: 0, skipped_identical: 0, overwritten: 0 };
  }
  const allColumns = Object.keys(firstRow);
  const columns = getInsertColumns(entry.table, allColumns);

  // Per-table policy. The default is FAIL_BY_DEFAULT (or SKIP_IF_IDENTICAL
  // for seed tables); --allow-overwrite + ALLOW_PROD_OVERWRITE=true →
  // OVERWRITE; --resume → RESUME_DO_NOTHING (we trust prior completion).
  const isResumed = resume && state.completed.includes(`public.${entry.table}`);
  const policy = getConflictPolicy(entry.table, {
    allowOverwrite,
    resume: isResumed,
  });

  // Strict trigger-disable gate — REGARDLESS of PROD count.
  const triggers = REQUIRES_TRIGGER_DISABLE[entry.table] || [];
  if (triggers.length > 0 && !allowDisableTriggers && !dryRun) {
    // 05_prepare_prod should have caught this already, but double-check at
    // execution time: a stale prepare_status from before the env change
    // would otherwise silently proceed.
    console.error(
      `✗ public.${entry.table}: importing this table requires ALLOW_DISABLE_IMPORT_TRIGGERS=true ` +
      `because of trigger(s) [${triggers.join(', ')}] which duplicate data unconditionally. ` +
      `(This is required even when PROD is empty.)`
    );
    throw new Error('requires_trigger_disable');
  }

  const doImport = async () => {
    let inserted = 0, skipped_identical = 0, overwritten = 0;
    let buffer = [];
    const flushOne = async (rows) => {
      if (dryRun) return { inserted: 0, skipped_identical: 0, overwritten: 0 };
      return batchInsert(client, {
        schema: 'public', table: entry.table, columns, rows, policy,
      });
    };
    for await (const row of readNdjson(path)) {
      buffer.push(row);
      if (buffer.length >= batchSize) {
        const r = await flushOne(buffer);
        inserted += r.inserted ?? 0;
        skipped_identical += r.skipped_identical ?? 0;
        overwritten += r.overwritten ?? 0;
        buffer = [];
      }
    }
    if (buffer.length > 0) {
      const r = await flushOne(buffer);
      inserted += r.inserted ?? 0;
      skipped_identical += r.skipped_identical ?? 0;
      overwritten += r.overwritten ?? 0;
    }
    return { inserted, skipped_identical, overwritten };
  };

  let result;
  if (triggers.length > 0 && allowDisableTriggers && !dryRun) {
    state.disabled_triggers.push({ table: entry.table, triggers });
    result = await withTempDisabledTriggers(
      client,
      { schema: 'public', table: entry.table, triggerNames: triggers },
      doImport,
    );
  } else {
    result = await doImport();
  }

  state.completed.push(`public.${entry.table}`);
  const tail = `${dryRun ? ' (dry-run)' : ''}${result.overwritten ? ` overwritten=${result.overwritten}` : ''}`;
  console.log(
    `${tag('PROD')} public.${entry.table}: policy=${policy} ` +
    `inserted=${result.inserted} skipped_identical=${result.skipped_identical}${tail}`,
  );
  return { table: entry.table, policy, ...result };
}

function saveState(path, state, dryRun) {
  if (dryRun) return;
  writeJson(path, state);
}

function writeImportReportMd(report) {
  const path = 'docs/old-to-prod/IMPORT_REPORT.md';
  const lines = [
    '# Import report',
    '',
    `> Generated by 06_import_prod.mjs.`,
    `> Started: ${report.started_at}, finished: ${report.finished_at || '(in progress)'}.`,
    `> Dry-run: ${report.dry_run ? 'YES' : 'no'}.`,
    '',
    '## Options',
    '',
    '```json',
    JSON.stringify(report.options, null, 2),
    '```',
    '',
    '## Clean-auth phase',
    '',
    report.clean_auth
      ? [
          `> Executed: ${report.clean_auth.executed ? 'YES' : 'NO (dry-run only)'}. ${report.clean_auth.dry_run ? '⚠ dry-run' : ''}`,
          '',
          '**Notes (auth-cutover semantics):**',
          ...report.clean_auth.notes.map((n) => `- ${n}`),
          '',
          '**Deletion plan (no CASCADE, leaves first):**',
          '',
          ...report.clean_auth.plan.order.map((t) => `- \`${t}\``),
          '',
          report.clean_auth.plan.audit_log_note ? `> ${report.clean_auth.plan.audit_log_note}` : '',
          report.clean_auth.plan.skipped_tables.length > 0
            ? `Auth tables left alone (no FK to users/identities): ${report.clean_auth.plan.skipped_tables.map((s) => '`' + s + '`').join(', ')}.`
            : '',
          report.clean_auth.plan.public_referrers.length > 0
            ? `\n**public → auth FKs detected** (required \`--clean-prod --confirm\`):\n\n` +
              '| FK | ON DELETE |\n|---|---|\n' +
              report.clean_auth.plan.public_referrers.map((r) => `| \`${r.from}\` → \`${r.to}\` | ${r.delete_rule} |`).join('\n')
            : '',
          '',
          '**Row counts:**',
          '',
          '| Table | Before | Deleted | After |',
          '|---|---:|---:|---:|',
          ...report.clean_auth.plan.order.map((t) =>
            `| \`${t}\` | ${report.clean_auth.before_counts[t] ?? '-'} | ${report.clean_auth.deleted[t] ?? '-'} | ${report.clean_auth.after_counts[t] ?? (report.clean_auth.dry_run ? '(dry-run)' : '-')} |`,
          ),
        ].filter(Boolean).join('\n')
      : 'Not requested (--clean-auth not set).',
    '',
    '## Auth phase',
    '',
    report.auth
      ? '```json\n' + JSON.stringify(report.auth, null, 2) + '\n```'
      : 'Skipped (--public-only or ALLOW_AUTH_IMPORT=false).',
    '',
    '## Public tables',
    '',
    'Conflict policy is per-table. `FAIL_BY_DEFAULT` is the default and never silently skips. `SKIP_IF_IDENTICAL` is used for seed tables; mismatched rows fail the import. `OVERWRITE` requires both `--allow-overwrite` and `ALLOW_PROD_OVERWRITE=true`.',
    '',
    '| Table | Policy | Inserted | Skipped (identical) | Overwritten | Error |',
    '|---|---|---:|---:|---:|---|',
  ];
  for (const t of report.per_table) {
    lines.push(
      `| ${t.table} | ${t.policy ?? '-'} | ${t.inserted ?? '-'} | ${t.skipped_identical ?? '-'} | ${t.overwritten ?? '-'} | ${t.error ?? ''} |`,
    );
  }
  try {
    writeFileSync(path, lines.join('\n') + '\n', 'utf8');
    console.log(`✓ wrote ${path}`);
  } catch (e) {
    console.error(`✗ failed to write ${path}: ${e.message}`);
  }
}

main().catch((e) => fatal(e));
