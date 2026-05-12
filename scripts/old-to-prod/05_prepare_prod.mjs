#!/usr/bin/env node
// 05_prepare_prod — readiness check for PROD Supabase before any import write.
//
// Read-only: connects to PROD, queries metadata + counts, writes:
//   - EXPORT_DIR/prepare_status.json   (machine-readable; consumed by 06_import_prod)
//   - docs/old-to-prod/PREPARE_REPORT.md (human-readable, not in git)
//
// Exit codes:
//   0 = READY
//   2 = missing prerequisite (export files, env vars)
//   3 = blockers in schema_diff
//   4 = PROD has data and overwrite/clean not authorized
//   5 = required functions/tables missing

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadDotenv, requireEnv, getClient, getExportDir, tag, writeJson, parseCliArgs,
  requireExportFiles, ensureNoBlockers, fatal,
} from './_lib.mjs';
import { IMPORT_ORDER, REQUIRES_TRIGGER_DISABLE } from './_tables.mjs';
import { getEnabledProviders, validateProvidersAgainstOld } from './_auth.mjs';
import { readNdjson } from './_copy.mjs';
import { compareEncryptedPasswords } from './_checksums.mjs';
import { redactEmail } from './_lib.mjs';

loadDotenv();

const { values } = parseCliArgs({
  name: '05_prepare_prod.mjs',
  description: 'Verify PROD Supabase is ready to receive OLD import.',
  options: {
    'dry-run':    { type: 'boolean', default: false, describe: 'Probe only; do not write status file' },
    'export-dir': { type: 'string',  default: '',    describe: 'Override EXPORT_DIR env' },
  },
});

const exportDir = values['export-dir'] || process.env.EXPORT_DIR || './.old-to-prod-export';
const dryRun = values['dry-run'];

// Blockers we know about and intentionally accept (PROD-only objects).
const BLOCKER_WHITELIST = []; // currently empty; PROD-only items are info-class

const REQUIRED_FUNCTIONS = [
  'register_user',
  'recalculate_tender_grand_total',
  'clone_tender_as_new_version',
  'notify_row_change',
  'get_positions_with_costs',
  'save_redistribution_results',
];

async function main() {
  requireExportFiles(exportDir, [
    'old_schema.json',
    'prod_schema.json',
    'schema_diff.json',
    'schema_diff.md',
    'manifest.json',
    'auth_stats.json',
  ], 'Run: npm run old-to-prod:introspect-old → :introspect-prod → :compare → :export');

  const prodUrl = requireEnv('PROD_SUPABASE_DB_URL');

  const schemaDiff = JSON.parse(readFileSync(join(exportDir, 'schema_diff.json'), 'utf8'));
  ensureNoBlockers(schemaDiff, BLOCKER_WHITELIST);

  const manifest = JSON.parse(readFileSync(join(exportDir, 'manifest.json'), 'utf8'));
  const oldAuthStats = JSON.parse(readFileSync(join(exportDir, 'auth_stats.json'), 'utf8'));

  console.log(`${tag('PROD')} connecting${dryRun ? ' (dry-run)' : ''}…`);
  const client = await getClient(prodUrl);

  const report = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    checks: [],
    status: 'PENDING',
  };

  try {
    // Check 1: required tables present
    for (const t of IMPORT_ORDER) {
      const exists = await tableExists(client, 'public', t);
      report.checks.push({ code: `prod_has_table:public.${t}`, ok: exists });
    }
    const authUsersOk = await tableExists(client, 'auth', 'users');
    const publicUsersOk = await tableExists(client, 'public', 'users');
    const authIdentitiesOk = await tableExists(client, 'auth', 'identities');
    report.checks.push({ code: 'prod_has_table:auth.users', ok: authUsersOk });
    report.checks.push({ code: 'prod_has_table:public.users', ok: publicUsersOk });
    report.checks.push({ code: 'prod_has_table:auth.identities', ok: authIdentitiesOk });

    // Check 2: required functions present
    const { rows: fns } = await client.query(`
      SELECT p.proname FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = ANY($1)
    `, [REQUIRED_FUNCTIONS]);
    const fnNames = new Set(fns.map((r) => r.proname));
    for (const fn of REQUIRED_FUNCTIONS) {
      report.checks.push({ code: `prod_has_function:${fn}`, ok: fnNames.has(fn) });
    }

    // Check 3: OAuth providers from OLD ⊆ PROD enabled providers
    const enabled = getEnabledProviders(process.env.PROD_ENABLED_AUTH_PROVIDERS);
    const missingProviders = validateProvidersAgainstOld(oldAuthStats, enabled);
    report.checks.push({
      code: 'oauth_providers_covered',
      ok: missingProviders.length === 0,
      detail: missingProviders.length ? `missing in PROD: ${missingProviders.join(', ')}` : null,
    });

    // Check 4: PROD users.count — block if non-empty without ALLOW flags
    const { rows: [pu] } = await client.query(`SELECT COUNT(*)::int AS n FROM public.users`);
    const prodUsersCount = pu.n;
    const allowOverwrite = process.env.ALLOW_PROD_OVERWRITE === 'true';
    const allowClean = process.env.ALLOW_CLEAN_PROD === 'true';
    const usersGate =
      prodUsersCount === 0 || allowOverwrite || allowClean;
    report.checks.push({
      code: 'prod_users_empty_or_authorized',
      ok: usersGate,
      detail: `prod public.users count = ${prodUsersCount}, ALLOW_PROD_OVERWRITE=${allowOverwrite}, ALLOW_CLEAN_PROD=${allowClean}`,
    });

    // Check 5: required-trigger-disable gate.
    //
    // For every table in REQUIRES_TRIGGER_DISABLE that IS in IMPORT_ORDER,
    // if its listed user-trigger exists on PROD, the import MUST run with
    // ALLOW_DISABLE_IMPORT_TRIGGERS=true. This is enforced REGARDLESS of
    // whether PROD is currently empty — the trigger duplicates rows either way
    // (auto_create_tender_registry generates a fresh UUID per imported tender;
    //  log_boq_items_changes inserts an audit row per touched boq_items row).
    const importedTables = new Set(IMPORT_ORDER);
    const requiredTriggerNames = Object.entries(REQUIRES_TRIGGER_DISABLE)
      .filter(([t]) => importedTables.has(t))
      .flatMap(([, ts]) => ts);
    const allowDisable = process.env.ALLOW_DISABLE_IMPORT_TRIGGERS === 'true';
    let foundRequired = [];
    if (requiredTriggerNames.length > 0) {
      const { rows: trigs } = await client.query(`
        SELECT t.tgname, c.relname AS table_name
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE NOT t.tgisinternal
           AND n.nspname = 'public'
           AND t.tgname = ANY($1)
         ORDER BY c.relname, t.tgname
      `, [requiredTriggerNames]);
      foundRequired = trigs.map((r) => `${r.table_name}.${r.tgname}`);
    }
    const triggersGate = foundRequired.length === 0 || allowDisable;
    report.checks.push({
      code: 'requires_trigger_disable_gate',
      ok: triggersGate,
      detail: foundRequired.length === 0
        ? 'no triggers requiring disable'
        : `${foundRequired.length} trigger(s) require ALLOW_DISABLE_IMPORT_TRIGGERS=true (current: ${allowDisable}). These ALWAYS duplicate data — not just when PROD is non-empty.`,
      triggers: foundRequired,
    });

    // Check 6: Preflight auth collision check.
    //
    // For every OLD-export auth.users / auth.identities row, look up PROD and
    // detect:
    //   - id already exists in PROD
    //   - email already exists in PROD (possibly under a different id)
    //   - same id but different email
    //   - same id but different sha256(encrypted_password)
    //   - identity collision on (provider, provider_id) for a foreign user_id
    //
    // Each finding is added to report.auth_collisions[] with masked diagnostics.
    // If any collision exists AND --resume isn't in effect (we can't prove
    // a prior import made them identical here — that's enforced row-by-row at
    // import time), this check FAILS prepare.
    const authCollisions = await runAuthCollisionPreflight(client, exportDir);
    const hasCollisions = authCollisions.length > 0;
    report.auth_collisions = authCollisions;
    report.checks.push({
      code: 'auth_preflight_collisions',
      ok: !hasCollisions,
      detail: hasCollisions
        ? `${authCollisions.length} auth collision(s) — see prepare report for masked details`
        : 'no auth.users / auth.identities collisions detected',
    });

    // Check 7: manifest sanity — every entry must have ndjson_path (or rows=0)
    const badManifest = (manifest.tables ?? []).filter(
      (t) => t.rows > 0 && !t.ndjson_path
    );
    report.checks.push({
      code: 'manifest_has_ndjson_for_nonempty',
      ok: badManifest.length === 0,
      detail: badManifest.length === 0 ? null : `${badManifest.length} tables missing ndjson_path`,
    });

    // Summarize
    const failed = report.checks.filter((c) => !c.ok);
    if (failed.length === 0) {
      report.status = 'READY';
    } else {
      report.status = 'BLOCKED';
      report.failed_codes = failed.map((c) => c.code);
    }

    // Print summary
    for (const c of report.checks) {
      const mark = c.ok ? '✓' : '✗';
      const note = c.detail ? ` — ${c.detail}` : '';
      console.log(`${tag('PROD')} ${mark} ${c.code}${note}`);
    }
    console.log(`${tag('PROD')} status: ${report.status}`);

    // Write artifacts
    if (!dryRun) {
      writeJson(join(exportDir, 'prepare_status.json'), report);
      writePrepareReportMd(report);
      console.log(`✓ wrote ${join(exportDir, 'prepare_status.json')}`);
    }

    if (report.status === 'BLOCKED') {
      // Pick an exit code based on first failure category.
      if (failed.some((c) => c.code === 'prod_users_empty_or_authorized')) process.exit(4);
      if (failed.some((c) => c.code.startsWith('prod_has_table') || c.code.startsWith('prod_has_function'))) process.exit(5);
      if (failed.some((c) => c.code === 'requires_trigger_disable_gate')) process.exit(6);
      process.exit(1);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function tableExists(client, schema, table) {
  const { rows } = await client.query(`SELECT to_regclass($1) AS reg`, [`${schema}.${table}`]);
  return rows[0]?.reg !== null;
}

/**
 * Preflight auth collision check. Read-only. Compares OLD export NDJSON
 * against current PROD state. Returns a list of finding objects with
 * MASKED diagnostics — never logs full email, never logs encrypted_password.
 */
async function runAuthCollisionPreflight(client, exportDir) {
  const usersPath = join(exportDir, 'data', 'auth.users.ndjson');
  const identitiesPath = join(exportDir, 'data', 'auth.identities.ndjson');
  const findings = [];

  if (existsSync(usersPath)) {
    // Build email → id and id → email indexes from OLD export.
    const oldUsers = [];
    for await (const row of readNdjson(usersPath)) oldUsers.push(row);
    if (oldUsers.length > 0) {
      const ids = oldUsers.map((u) => u.id);
      // SELECT relevant PROD rows in one query.
      const { rows: prodById } = await client.query(
        `SELECT id, email, encrypted_password FROM auth.users WHERE id = ANY($1)`,
        [ids],
      );
      const prodByIdMap = new Map(prodById.map((r) => [r.id, r]));

      const emails = oldUsers.map((u) => u.email).filter(Boolean);
      const { rows: prodByEmail } = await client.query(
        `SELECT id, email FROM auth.users WHERE email = ANY($1)`,
        [emails],
      );
      const prodByEmailMap = new Map(prodByEmail.map((r) => [r.email, r]));

      for (const old of oldUsers) {
        const byId = prodByIdMap.get(old.id);
        if (byId) {
          // id collision
          if (byId.email !== old.email) {
            findings.push({
              kind: 'auth_users_id_email_mismatch',
              user_id: old.id,
              old_email_masked: redactEmail(old.email),
              prod_email_masked: redactEmail(byId.email),
            });
          }
          if (!compareEncryptedPasswords(old.encrypted_password, byId.encrypted_password)) {
            findings.push({
              kind: 'auth_users_password_hash_differs',
              user_id: old.id,
              email_masked: redactEmail(old.email),
            });
          }
          // identical id+email+password → only OK in --resume; we still surface
          // because prepare must not silently green-light overwrite.
          if (
            byId.email === old.email &&
            compareEncryptedPasswords(old.encrypted_password, byId.encrypted_password)
          ) {
            findings.push({
              kind: 'auth_users_already_present_identical',
              user_id: old.id,
              email_masked: redactEmail(old.email),
              resume_safe: true,
            });
          }
        }
        const byEmail = old.email ? prodByEmailMap.get(old.email) : null;
        if (byEmail && byEmail.id !== old.id) {
          findings.push({
            kind: 'auth_users_email_collision_different_id',
            email_masked: redactEmail(old.email),
            old_id: old.id,
            prod_id: byEmail.id,
          });
        }
      }
    }
  }

  if (existsSync(identitiesPath)) {
    const oldIdents = [];
    for await (const row of readNdjson(identitiesPath)) oldIdents.push(row);
    if (oldIdents.length > 0) {
      const ids = oldIdents.map((i) => i.id);
      const { rows: byId } = await client.query(
        `SELECT id, user_id, provider, provider_id FROM auth.identities WHERE id = ANY($1)`,
        [ids],
      );
      const byIdMap = new Map(byId.map((r) => [r.id, r]));
      const pairs = oldIdents.map((i) => ({ provider: i.provider, provider_id: i.provider_id }));
      const { rows: byPair } = await client.query(
        `SELECT id, user_id, provider, provider_id FROM auth.identities
         WHERE (provider, provider_id) IN (
           ${pairs.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(', ') || `('','')`}
         )`,
        pairs.flatMap((p) => [p.provider, p.provider_id]),
      );
      const byPairMap = new Map(byPair.map((r) => [`${r.provider}:${r.provider_id}`, r]));

      for (const old of oldIdents) {
        const sameId = byIdMap.get(old.id);
        if (sameId) {
          if (sameId.user_id !== old.user_id) {
            findings.push({
              kind: 'auth_identities_user_id_mismatch',
              identity_id: old.id,
              old_user_id: old.user_id,
              prod_user_id: sameId.user_id,
            });
          }
          if (sameId.provider !== old.provider) {
            findings.push({
              kind: 'auth_identities_provider_mismatch',
              identity_id: old.id,
              old_provider: old.provider,
              prod_provider: sameId.provider,
            });
          }
        }
        const pairKey = `${old.provider}:${old.provider_id}`;
        const samePair = byPairMap.get(pairKey);
        if (samePair && samePair.user_id !== old.user_id) {
          findings.push({
            kind: 'auth_identities_pair_collision_different_user',
            provider: old.provider,
            old_user_id: old.user_id,
            prod_user_id: samePair.user_id,
          });
        }
      }
    }
  }

  return findings;
}

function writePrepareReportMd(report) {
  const path = 'docs/old-to-prod/PREPARE_REPORT.md';
  const lines = [
    '# Prepare PROD report',
    '',
    `> Generated by 05_prepare_prod.mjs at ${report.generated_at}.`,
    '> This file is regenerated on every run and intentionally not committed to git.',
    '',
    `## Status: **${report.status}**`,
    '',
    '## Checks',
    '',
    '| Code | Status | Detail |',
    '|---|---|---|',
  ];
  for (const c of report.checks) {
    const detail = (c.detail ?? '').replace(/\|/g, '\\|');
    lines.push(`| \`${c.code}\` | ${c.ok ? '✓' : '✗'} | ${detail} |`);
  }
  if (report.status !== 'READY') {
    lines.push('');
    lines.push('## Failed codes');
    for (const f of report.failed_codes ?? []) lines.push(`- \`${f}\``);
  }
  try {
    writeFileSync(path, lines.join('\n') + '\n', 'utf8');
    console.log(`✓ wrote ${path}`);
  } catch (e) {
    console.error(`✗ could not write ${path}: ${e.message}`);
  }
}

main().catch((e) => fatal(e));
