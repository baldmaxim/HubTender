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
  requireExportFiles, ensureNoBlockers, fatal, assertMcpPreflightOk,
  assertCleanAuthAllowed,
} from './_lib.mjs';
import { IMPORT_ORDER, REQUIRES_TRIGGER_DISABLE } from './_tables.mjs';
import {
  getEnabledProviders, validateProvidersAgainstOld,
  loadAuthFkGraph, listAuthTables, planAuthCleanup,
} from './_auth.mjs';
import { readNdjson } from './_copy.mjs';
import { compareEncryptedPasswords } from './_checksums.mjs';
import { redactEmail } from './_lib.mjs';

loadDotenv();

const { values } = parseCliArgs({
  name: '05_prepare_prod.mjs',
  description: 'Verify PROD Supabase is ready to receive OLD import.',
  options: {
    'dry-run':            { type: 'boolean', default: false, describe: 'Probe only; do not write status file' },
    'export-dir':         { type: 'string',  default: '',    describe: 'Override EXPORT_DIR env' },
    'use-mcp-preflight':  { type: 'boolean', default: false, describe: 'Trust .old-to-prod-export/schema_diff.json (source=mcp) instead of old_schema/prod_schema files' },
    'clean-auth':         { type: 'boolean', default: false, describe: 'Plan DELETE of PROD auth schema before auth import (3-key guard, see RUNBOOK)' },
    'clean-prod':         { type: 'boolean', default: false, describe: 'Plan TRUNCATE of PROD public schema (forwarded to :import)' },
    'confirm':            { type: 'boolean', default: false, describe: 'Required with --clean-prod' },
  },
});

const exportDir = values['export-dir'] || process.env.EXPORT_DIR || './.old-to-prod-export';
const dryRun = values['dry-run'];
const useMcpPreflight = values['use-mcp-preflight'];
const cleanAuthCli = values['clean-auth'];
const cleanProdCli = values['clean-prod'];
const cleanProdConfirm = values['confirm'];

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
  // Surface the 3-key gate BEFORE file requirements: env mistakes are the most
  // common operator error and should fail loudly before "manifest.json not
  // found" obscures the real cause. Only validate scope-relevant pieces here
  // (full env+collision+MCP check); the same helper is called again at runtime
  // in 06_import_prod for defense-in-depth.
  let cleanAuthCtx = null;
  if (cleanAuthCli) {
    cleanAuthCtx = assertCleanAuthAllowed({ exportDir, cliFlag: true, dryRun });
  }

  // File requirements differ when consuming an MCP live preflight: the
  // old_schema/prod_schema introspect dumps are not produced in MCP mode.
  const requiredFiles = useMcpPreflight
    ? ['schema_diff.json', 'schema_diff.md', 'manifest.json', 'auth_stats.json']
    : ['old_schema.json', 'prod_schema.json', 'schema_diff.json', 'schema_diff.md', 'manifest.json', 'auth_stats.json'];
  const hint = useMcpPreflight
    ? 'Run: MCP live preflight + npm run old-to-prod:export'
    : 'Run: npm run old-to-prod:introspect-old → :introspect-prod → :compare → :export';
  requireExportFiles(exportDir, requiredFiles, hint);

  const prodUrl = requireEnv('PROD_SUPABASE_DB_URL');

  let schemaDiff;
  if (useMcpPreflight) {
    // Validates source=mcp, blockers empty, MCP_PREFLIGHT.md not FAILED. Prepare
    // is read-only by design, so we do NOT enforce ALLOW_* env gates here —
    // those belong to 06_import_prod.mjs (which calls the same helper with
    // enforceImportGates=true).
    const mcp = assertMcpPreflightOk({ exportDir, dryRun, enforceImportGates: false });
    schemaDiff = mcp.schemaDiff;
    console.log(`${tag('PROD')} MCP preflight: ${mcp.status}`);
  } else {
    schemaDiff = JSON.parse(readFileSync(join(exportDir, 'schema_diff.json'), 'utf8'));
    ensureNoBlockers(schemaDiff, BLOCKER_WHITELIST);
  }

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
    // When --clean-auth is set AND the public-dependency gate has already
    // passed (= clean-auth will run before auth import and wipe the auth target),
    // collisions are EXPECTED — they're exactly the data that clean-auth
    // resolves. Downgrade to an informational pass.
    const cleanAuthResolvesIt = cleanAuthCli;
    report.checks.push({
      code: 'auth_preflight_collisions',
      ok: !hasCollisions || cleanAuthResolvesIt,
      detail: !hasCollisions
        ? 'no auth.users / auth.identities collisions detected'
        : cleanAuthResolvesIt
          ? `${authCollisions.length} auth collision(s) — will be resolved by --clean-auth (DELETE then re-import)`
          : `${authCollisions.length} auth collision(s) — see prepare report for masked details`,
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

    // Check 8: clean-auth plan (only when --clean-auth is requested).
    //
    // We build the plan here (read-only) so 06_import_prod can either consume
    // it OR rebuild it fresh — having it surfaced in PREPARE_REPORT.md gives
    // the operator a chance to inspect what tables would be touched BEFORE any
    // destructive write occurs.
    if (cleanAuthCli) {
      // Gate already validated at top of main(); reuse the context object.
      // (If a previous early-exit slipped past — defense in depth.)
      if (!cleanAuthCtx) cleanAuthCtx = assertCleanAuthAllowed({ exportDir, cliFlag: true, dryRun });

      // Build the FK-driven plan against live PROD.
      const fkGraph = await loadAuthFkGraph(client);
      const authTables = await listAuthTables(client);
      let plan;
      try {
        plan = planAuthCleanup(fkGraph, authTables);
      } catch (e) {
        report.checks.push({
          code: 'clean_auth_fk_plan',
          ok: false,
          detail: e.message,
        });
        throw e;
      }
      report.clean_auth_plan = {
        recommendation: cleanAuthCtx.collision.recommendation,
        mcp_status: cleanAuthCtx.status,
        order: plan.order.map((t) => `${t.schema}.${t.table}`),
        skipped_tables: plan.skipped_tables.map((t) => `auth.${t}`),
        public_referrers: plan.public_referrers.map((fk) => ({
          from: `${fk.from_schema}.${fk.from_table}.${fk.from_column}`,
          to: `${fk.to_schema}.${fk.to_table}.${fk.to_column}`,
          delete_rule: fk.delete_rule,
        })),
        audit_log_note: plan.audit_log_note,
        requires_clean_prod: plan.public_referrers.length > 0,
      };

      // Gate: if any public table references auth.users / auth.identities,
      // --clean-prod --confirm + ALLOW_CLEAN_PROD=true MUST also be set.
      const allowCleanProd = process.env.ALLOW_CLEAN_PROD === 'true';
      const publicChainOk =
        plan.public_referrers.length === 0 ||
        (cleanProdCli && cleanProdConfirm && allowCleanProd);
      report.checks.push({
        code: 'clean_auth_public_dependency_gate',
        ok: publicChainOk,
        detail: plan.public_referrers.length === 0
          ? 'no public→auth FK; standalone --clean-auth is safe'
          : publicChainOk
            ? `${plan.public_referrers.length} public→auth FK(s) — --clean-prod --confirm + ALLOW_CLEAN_PROD=true present, OK`
            : 'Cannot clean auth.users while public.users still references auth.users. Use --clean-prod --confirm or resolve manually.',
        public_referrers: report.clean_auth_plan.public_referrers,
      });
      report.checks.push({
        code: 'clean_auth_fk_plan',
        ok: true,
        detail: `${plan.order.length} table(s) would be DELETE'd in order: ${plan.order.map((t) => t.table).join(' → ')}`,
      });

      console.log(`${tag('PROD')} clean-auth plan: ${plan.order.length} table(s) — ${plan.order.map((t) => t.table).join(' → ')}`);
      if (plan.public_referrers.length > 0) {
        console.log(`${tag('PROD')} ⚠ ${plan.public_referrers.length} public→auth FK(s) — --clean-prod --confirm REQUIRED in import phase.`);
      }
      if (plan.audit_log_note) console.log(`${tag('PROD')} ${plan.audit_log_note}`);
    }

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

    // Write artifacts. Even in --dry-run we persist the status file (with
    // dry_run:true preserved in the report) so downstream stages of a
    // dry-run pipeline can read it. 06_import_prod refuses to do real writes
    // when prepare_status.dry_run=true (defense in depth).
    writeJson(join(exportDir, 'prepare_status.json'), report);
    writePrepareReportMd(report);
    console.log(`✓ wrote ${join(exportDir, 'prepare_status.json')}${dryRun ? ' (dry-run flagged)' : ''}`);

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
  if (report.clean_auth_plan) {
    const p = report.clean_auth_plan;
    lines.push('');
    lines.push('## Clean-auth plan');
    lines.push('');
    lines.push(`- collision-analysis recommendation: \`${p.recommendation}\``);
    lines.push(`- MCP preflight status: \`${p.mcp_status}\``);
    lines.push(`- requires \`--clean-prod --confirm\`: **${p.requires_clean_prod ? 'YES' : 'no'}**`);
    if (p.audit_log_note) lines.push(`- audit-log note: ${p.audit_log_note}`);
    lines.push('');
    lines.push('### Deletion order (leaves first; auth.users last; no CASCADE)');
    lines.push('');
    for (const t of p.order) lines.push(`- \`${t}\``);
    if (p.skipped_tables.length > 0) {
      lines.push('');
      lines.push('### Auth tables left alone');
      lines.push('');
      for (const t of p.skipped_tables) lines.push(`- \`${t}\``);
    }
    if (p.public_referrers.length > 0) {
      lines.push('');
      lines.push('### public → auth FKs (block standalone clean-auth)');
      lines.push('');
      lines.push('| FK | ON DELETE |');
      lines.push('|---|---|');
      for (const r of p.public_referrers) lines.push(`| \`${r.from}\` → \`${r.to}\` | ${r.delete_rule} |`);
    }
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
