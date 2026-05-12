#!/usr/bin/env node
// 08_verify_auth — verify auth.users / auth.identities after import.
//
// - Compares counts (PROD >= OLD).
// - Byte-to-byte compare of encrypted_password via sha256 — hash never logged.
// - Smoke-login via Supabase Auth REST + optional Go BFF /api/v1/me probe.
// - Writes docs/old-to-prod/AUTH_VERIFY_RESULT.md.
//
// Exit codes: 0 = AUTH_VERIFY_OK / WITH_WARNINGS, 1 = AUTH_VERIFY_FAILED.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadDotenv, requireEnv, getClient, tag, parseCliArgs,
  requireExportFiles, redactEmail, fatal,
} from './_lib.mjs';
import { readNdjson } from './_copy.mjs';
import { compareEncryptedPasswords } from './_checksums.mjs';
import { smokeLogin, callGoBffMe, collectAuthStats, listInsertableColumns } from './_auth.mjs';

loadDotenv();

const { values } = parseCliArgs({
  name: '08_verify_auth.mjs',
  description: 'Verify auth.users/identities counts + password hashes byte-to-byte + smoke login.',
  options: {
    'dry-run':    { type: 'boolean', default: false, describe: 'Probe only; do not write AUTH_VERIFY_RESULT.md' },
    'export-dir': { type: 'string',  default: '',    describe: 'Override EXPORT_DIR env' },
  },
});

const exportDir = values['export-dir'] || process.env.EXPORT_DIR || './.old-to-prod-export';
const dryRun = values['dry-run'];

async function main() {
  requireExportFiles(exportDir, ['auth_stats.json', 'manifest.json'], 'Run :export first.');

  const prodDbUrl = requireEnv('PROD_SUPABASE_DB_URL');
  const oldAuthStats = JSON.parse(readFileSync(join(exportDir, 'auth_stats.json'), 'utf8'));

  const client = await getClient(prodDbUrl);
  const report = {
    generated_at: new Date().toISOString(),
    counts: {},
    set_comparison: null,
    password_compare: null,
    password_user_audit: null,
    oauth_only_audit: null,
    bootstrap_audit: null,
    confirm_audit: null,
    clean_auth_context: null,
    smoke_login: null,
    go_bff_me: null,
    warnings: [],
    status: 'PENDING',
  };

  // import_state.json gives us bootstrap-identity provenance (created_user_ids).
  const statePath = join(exportDir, 'import_state.json');
  const importState = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, 'utf8'))
    : {};
  const forceConfirmEmails = process.env.FORCE_CONFIRM_EMAILS === 'true';

  try {
    // ---- Generated-column audit on auth.identities ----
    //
    // Supabase Auth ≥2023.5 marks `auth.identities.email` as
    // GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED. After
    // import we verify that every row's email column equals the computed
    // expression (PG enforces this by construction; this check just surfaces
    // schema drift if Supabase changes the generation expression).
    try {
      const identCols = await listInsertableColumns(client, 'auth', 'identities');
      const generatedEmail = identCols.skipped.find((s) => s.name === 'email' && s.reason === 'GENERATED ALWAYS');
      report.identities_generated_columns = {
        email_is_generated: !!generatedEmail,
        skipped_at_import: identCols.skipped,
      };
      if (generatedEmail) {
        // PG enforces equality, but a sanity probe: any row where email
        // disagrees with lower(identity_data->>'email') means schema drift.
        const { rows: [d] } = await client.query(`
          SELECT COUNT(*)::int AS n
            FROM auth.identities
           WHERE email IS DISTINCT FROM lower(identity_data->>'email')
        `);
        report.identities_generated_columns.email_drift_count = d.n;
        console.log(
          `${tag('PROD')} auth.identities.email is GENERATED ALWAYS; drift count=${d.n} ` +
          `${d.n === 0 ? '✓' : '✗'}`,
        );
      }
    } catch (e) {
      report.warnings.push(`generated-column audit failed: ${e.message}`);
    }

    // ---- Clean-auth context (read-only echo from import_state) ----
    if (importState.clean_auth) {
      report.clean_auth_context = {
        executed: !!importState.clean_auth.executed,
        dry_run: !!importState.clean_auth.dry_run,
        order: importState.clean_auth.order ?? [],
        deleted_total: importState.clean_auth.deleted_total ?? 0,
      };
      console.log(
        `${tag('PROD')} clean-auth context: executed=${report.clean_auth_context.executed} ` +
        `dry_run=${report.clean_auth_context.dry_run} ` +
        `tables=${report.clean_auth_context.order.length} ` +
        `deleted_total=${report.clean_auth_context.deleted_total}`,
      );
    }

    // ---- Counts (strict equality, accounting for documented bootstrap) ----
    //
    // auth.users          : PROD count MUST EQUAL OLD count. Extra PROD rows
    //                       are forbidden — they indicate either an unintended
    //                       legacy user (preexisting PROD test account) or a
    //                       miscount; either way the result is data drift.
    //
    // auth.identities     : PROD count MUST EQUAL OLD count + bootstrap.created.
    //                       Bootstrap creates email-identity rows on PROD for
    //                       legacy OLD users that lacked one (closes R-07);
    //                       those are documented in import_state.bootstrapped_identities.
    //
    // Any deviation here is a hard FAIL. The set-comparison block below would
    // also catch it (via extra-ids / missing-ids), but having an explicit
    // equality check on counts makes the diagnostic clearer.
    const bootstrapCreatedIds = importState.bootstrapped_identities ?? [];
    const expectedProdIdentities = oldAuthStats.auth_identities_count + bootstrapCreatedIds.length;
    const prodStats = await collectAuthStats(client);
    report.counts = {
      old: {
        auth_users: oldAuthStats.auth_users_count,
        identities: oldAuthStats.auth_identities_count,
      },
      prod: {
        auth_users: prodStats.auth_users_count,
        identities: prodStats.auth_identities_count,
      },
      bootstrap_created: bootstrapCreatedIds.length,
      expected_prod_identities: expectedProdIdentities,
      ok_users: prodStats.auth_users_count === oldAuthStats.auth_users_count,
      ok_identities: prodStats.auth_identities_count === expectedProdIdentities,
    };
    console.log(
      `${tag('PROD')} auth.users old=${oldAuthStats.auth_users_count} prod=${prodStats.auth_users_count} ` +
      `${report.counts.ok_users ? '✓ ==' : '✗ (must be ==)'}`,
    );
    console.log(
      `${tag('PROD')} auth.identities old=${oldAuthStats.auth_identities_count} + bootstrap=${bootstrapCreatedIds.length} ` +
      `→ expected=${expectedProdIdentities} prod=${prodStats.auth_identities_count} ` +
      `${report.counts.ok_identities ? '✓ ==' : '✗ (must be ==)'}`,
    );

    // ---- Password byte-to-byte ----
    const usersPath = join(exportDir, 'data', 'auth.users.ndjson');
    if (existsSync(usersPath)) {
      const cmp = await comparePasswords(client, usersPath);
      report.password_compare = cmp;
      console.log(
        `${tag('PROD')} passwords: match=${cmp.match} mismatch=${cmp.mismatch} ` +
        `missing_in_prod=${cmp.missing_in_prod} both_null=${cmp.both_null}`
      );
    } else {
      report.warnings.push('auth.users.ndjson not present; password compare skipped');
    }

    // ---- Set comparison: id, email, identities.user_id ----
    // `bootstrappedUserIds` is the set of OLD users for whom 06_import_prod
    // inserted a new email-identity in PROD (recorded in import_state). When
    // comparing identity-user-id sets, we treat these as "expected in PROD
    // but not in OLD identities export" so they don't show up as drift.
    const identitiesPath = join(exportDir, 'data', 'auth.identities.ndjson');
    if (existsSync(usersPath)) {
      const cmp = await compareAuthSets(client, usersPath, identitiesPath, bootstrapCreatedIds);
      report.set_comparison = cmp;
      console.log(
        `${tag('PROD')} auth sets: ` +
        `ids_match=${cmp.ids_equal} emails_match=${cmp.emails_equal} ` +
        `identities_user_ids_match=${cmp.identities_user_ids_equal}`,
      );
    }

    // ---- Password-user audit: every OLD password user has a PROD encrypted_password ----
    if (existsSync(usersPath)) {
      const audit = await auditPasswordUsers(client, usersPath);
      report.password_user_audit = audit;
      console.log(
        `${tag('PROD')} password users: ok=${audit.ok}/${audit.total} ` +
        `missing_in_prod=${audit.missing_in_prod} prod_null_but_old_had=${audit.prod_null_but_old_had}`,
      );
    }

    // ---- OAuth-only user audit: never silently became password users ----
    if (existsSync(usersPath)) {
      const audit = await auditOAuthOnlyUsers(client, usersPath);
      report.oauth_only_audit = audit;
      console.log(
        `${tag('PROD')} oauth-only users: ok=${audit.ok}/${audit.total} ` +
        `accidentally_password=${audit.accidentally_password}`,
      );
    }

    // ---- Bootstrap identities audit ----
    if (existsSync(identitiesPath)) {
      const bootstrap = await auditBootstrap(client, identitiesPath, importState);
      report.bootstrap_audit = bootstrap;
      console.log(
        `${tag('PROD')} bootstrap audit: created=${bootstrap.created} ` +
        `duplicate_provider_pairs=${bootstrap.duplicate_provider_pairs}`,
      );
    }

    // ---- Confirm-email policy audit ----
    if (existsSync(usersPath)) {
      const confirm = await auditEmailConfirmation(client, usersPath, forceConfirmEmails);
      report.confirm_audit = confirm;
      console.log(
        `${tag('PROD')} confirm audit: forced=${forceConfirmEmails} ` +
        `unexpectedly_changed=${confirm.unexpectedly_changed} forced_count=${confirm.forced_count ?? 0}`,
      );
    }

    // ---- Smoke login ----
    const email = process.env.MIGRATION_SMOKE_EMAIL;
    const password = process.env.MIGRATION_SMOKE_PASSWORD;
    const prodUrl = process.env.PROD_SUPABASE_URL;
    const prodAnon = process.env.PROD_SUPABASE_ANON_KEY;

    if (email && password && prodUrl && prodAnon) {
      try {
        const session = await smokeLogin({ url: prodUrl, anonKey: prodAnon, email, password });
        const hasToken = typeof session.access_token === 'string' && session.access_token.length > 0;
        const userId = session.user?.id ?? null;
        report.smoke_login = {
          ok: hasToken,
          user_id: userId,
          email_masked: redactEmail(email),
        };
        console.log(`${tag('PROD')} smoke login ${hasToken ? '✓' : '✗'} (${redactEmail(email)})`);

        const goUrl = process.env.GO_BFF_BASE_URL;
        if (goUrl && hasToken) {
          try {
            const me = await callGoBffMe({ baseUrl: goUrl, accessToken: session.access_token });
            const meOk = !!me?.id && !!me?.email;
            report.go_bff_me = {
              ok: meOk,
              role_code: me?.role_code ?? me?.role ?? null,
              access_status: me?.access_status ?? null,
            };
            console.log(`${tag('PROD')} Go BFF /api/v1/me ${meOk ? '✓' : '✗'}`);
          } catch (e) {
            report.go_bff_me = { ok: false, error: e.message };
            report.warnings.push(`Go BFF /me failed: ${e.message}`);
          }
        }
      } catch (e) {
        report.smoke_login = { ok: false, error: e.message, email_masked: redactEmail(email) };
        report.warnings.push(`smoke login failed: ${e.message}`);
      }
    } else {
      report.warnings.push(
        'MIGRATION_SMOKE_EMAIL / MIGRATION_SMOKE_PASSWORD / PROD_SUPABASE_URL / PROD_SUPABASE_ANON_KEY ' +
        'not all set — login proof skipped. Cannot prove password-based auth without plaintext test pwd.'
      );
    }

    // ---- Status ----
    // AUTH_VERIFY_OK requires ALL of:
    //   - counts: PROD >= OLD for both auth.users and auth.identities
    //   - id+email sets equal between OLD export and PROD
    //   - password sha256 match for every OLD password-user
    //   - OAuth-only users never gained a password in PROD
    //   - bootstrap created no duplicate (provider, provider_id)
    //   - confirm-email policy was honoured
    //   - smoke login worked (when credentials were provided)
    const countOk = report.counts.ok_users && report.counts.ok_identities;
    const setsOk = !report.set_comparison || (
      report.set_comparison.ids_equal &&
      report.set_comparison.emails_equal &&
      report.set_comparison.identities_user_ids_equal
    );
    const pwOk = !report.password_compare || (
      report.password_compare.mismatch === 0 &&
      report.password_compare.missing_in_prod === 0
    );
    const pwUserAuditOk = !report.password_user_audit || (
      report.password_user_audit.missing_in_prod === 0 &&
      report.password_user_audit.prod_null_but_old_had === 0
    );
    const oauthOk = !report.oauth_only_audit || report.oauth_only_audit.accidentally_password === 0;
    const bootstrapOk = !report.bootstrap_audit || report.bootstrap_audit.duplicate_provider_pairs === 0;
    const confirmOk = !report.confirm_audit || report.confirm_audit.unexpectedly_changed === 0;
    const loginPresent = report.smoke_login != null;
    const loginOk = !loginPresent || report.smoke_login.ok;
    // Generated-column audit: drift > 0 is FAIL (schema mismatch with our
    // assumption that auth.identities.email = lower(identity_data->>'email')).
    const genOk = !report.identities_generated_columns?.email_is_generated
      || (report.identities_generated_columns.email_drift_count ?? 0) === 0;

    if (!countOk || !setsOk || !pwOk || !pwUserAuditOk || !oauthOk || !bootstrapOk || !confirmOk || !loginOk || !genOk) {
      report.status = 'AUTH_VERIFY_FAILED';
    } else if (!loginPresent || report.warnings.length > 0) {
      report.status = 'AUTH_VERIFY_OK_WITH_WARNINGS';
    } else {
      report.status = 'AUTH_VERIFY_OK';
    }
    if (!dryRun) writeReport(report);
    console.log(`${tag('PROD')} status: ${report.status}`);
    if (report.status === 'AUTH_VERIFY_FAILED') process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Compare id-sets, email-sets and identities.user_id-sets between OLD export
 * and current PROD state. Returns booleans + masked counts; no emails leak.
 *
 * @param {string[]} bootstrappedUserIds - user_ids for whom 06_import_prod's
 *   bootstrap step created a new email-identity in PROD. These are NOT in the
 *   OLD identities export, but are EXPECTED to be in PROD. Treated as part
 *   of the "OLD ∪ bootstrap" set when comparing identities.user_id.
 */
async function compareAuthSets(client, usersPath, identitiesPath, bootstrappedUserIds = []) {
  const oldIds = new Set();
  const oldEmails = new Set();
  for await (const row of readNdjson(usersPath)) {
    oldIds.add(row.id);
    if (row.email) oldEmails.add(row.email);
  }
  const oldIdentitiesUserIds = new Set();
  if (identitiesPath && existsSync(identitiesPath)) {
    for await (const row of readNdjson(identitiesPath)) {
      if (row.user_id) oldIdentitiesUserIds.add(row.user_id);
    }
  }
  // Expected PROD identity-user-id set = OLD identities ∪ bootstrap-created.
  const expectedIdentityUserIds = new Set([...oldIdentitiesUserIds, ...bootstrappedUserIds]);

  const { rows: prodUsers } = await client.query(`SELECT id, email FROM auth.users`);
  const prodIds = new Set(prodUsers.map((r) => r.id));
  const prodEmails = new Set(prodUsers.filter((r) => r.email).map((r) => r.email));
  const { rows: prodIdents } = await client.query(`SELECT user_id FROM auth.identities`);
  const prodIdentUserIds = new Set(prodIdents.map((r) => r.user_id));

  const idsMissingInProd = [...oldIds].filter((id) => !prodIds.has(id));
  const idsExtraInProd = [...prodIds].filter((id) => !oldIds.has(id));
  const emailsMissingInProd = [...oldEmails].filter((e) => !prodEmails.has(e)).map(redactEmail);
  const emailsExtraInProd = [...prodEmails].filter((e) => !oldEmails.has(e)).map(redactEmail);
  const identityUsersMissing = [...expectedIdentityUserIds].filter((u) => !prodIdentUserIds.has(u));
  const identityUsersExtra = [...prodIdentUserIds].filter((u) => !expectedIdentityUserIds.has(u));

  return {
    ids_equal: idsMissingInProd.length === 0 && idsExtraInProd.length === 0,
    emails_equal: emailsMissingInProd.length === 0 && emailsExtraInProd.length === 0,
    identities_user_ids_equal:
      identityUsersMissing.length === 0 && identityUsersExtra.length === 0,
    counts: {
      old_users: oldIds.size,
      prod_users: prodIds.size,
      old_emails: oldEmails.size,
      prod_emails: prodEmails.size,
      old_identities_user_ids: oldIdentitiesUserIds.size,
      bootstrap_user_ids: bootstrappedUserIds.length,
      expected_identities_user_ids: expectedIdentityUserIds.size,
      prod_identities_user_ids: prodIdentUserIds.size,
    },
    deltas: {
      ids_missing_in_prod: idsMissingInProd.length,
      ids_extra_in_prod: idsExtraInProd.length,
      emails_missing_in_prod: emailsMissingInProd.length,
      emails_extra_in_prod: emailsExtraInProd.length,
      identity_users_missing_in_prod: identityUsersMissing.length,
      identity_users_extra_in_prod: identityUsersExtra.length,
    },
  };
}

/**
 * Every OLD password user (encrypted_password IS NOT NULL) must have a
 * present-and-non-null encrypted_password in PROD too.
 */
async function auditPasswordUsers(client, usersPath) {
  let total = 0, ok = 0, missing_in_prod = 0, prod_null_but_old_had = 0;
  for await (const row of readNdjson(usersPath)) {
    if (row.encrypted_password == null) continue;
    total++;
    const { rows } = await client.query(
      `SELECT encrypted_password FROM auth.users WHERE id = $1`,
      [row.id],
    );
    if (rows.length === 0) { missing_in_prod++; continue; }
    if (rows[0].encrypted_password == null) { prod_null_but_old_had++; continue; }
    ok++;
  }
  return { total, ok, missing_in_prod, prod_null_but_old_had };
}

/**
 * OAuth-only OLD users (encrypted_password NULL) must remain password-less
 * in PROD — never silently promoted to password users.
 */
async function auditOAuthOnlyUsers(client, usersPath) {
  let total = 0, ok = 0, accidentally_password = 0;
  for await (const row of readNdjson(usersPath)) {
    if (row.encrypted_password != null) continue;
    total++;
    const { rows } = await client.query(
      `SELECT encrypted_password FROM auth.users WHERE id = $1`,
      [row.id],
    );
    if (rows.length === 0) { ok++; continue; } // not migrated, fine
    if (rows[0].encrypted_password != null) {
      accidentally_password++;
    } else {
      ok++;
    }
  }
  return { total, ok, accidentally_password };
}

/**
 * Audit bootstrap identities (those created by bootstrapMissingIdentities()):
 * no (provider, provider_id) pair should appear twice in PROD.
 */
async function auditBootstrap(client, identitiesPath, importState) {
  const createdIds = new Set(importState.bootstrapped_identities ?? []);
  const { rows: dupRows } = await client.query(`
    SELECT provider, provider_id, COUNT(*)::int AS n
      FROM auth.identities
     GROUP BY provider, provider_id
     HAVING COUNT(*) > 1
     LIMIT 50
  `);
  return {
    created: createdIds.size,
    duplicate_provider_pairs: dupRows.length,
    duplicate_provider_pairs_sample: dupRows.map((r) => `${r.provider}:${r.provider_id.slice(0, 6)}…`),
  };
}

/**
 * Check that email_confirmed_at policy was honoured:
 *   - FORCE_CONFIRM_EMAILS=false → every email_confirmed_at in PROD equals
 *     the OLD export value (no unexpected changes).
 *   - FORCE_CONFIRM_EMAILS=true  → count how many were set; we cannot verify
 *     "only those with email provider" perfectly here without re-joining
 *     identities, but we surface the aggregate so it can be sanity-checked.
 */
async function auditEmailConfirmation(client, usersPath, forceConfirmEmails) {
  let unexpectedly_changed = 0;
  let forced_count = 0;
  for await (const row of readNdjson(usersPath)) {
    const { rows } = await client.query(
      `SELECT email_confirmed_at FROM auth.users WHERE id = $1`,
      [row.id],
    );
    if (rows.length === 0) continue;
    const oldVal = row.email_confirmed_at;
    const prodVal = rows[0].email_confirmed_at;
    if (forceConfirmEmails) {
      if (oldVal == null && prodVal != null) forced_count++;
      continue;
    }
    // FORCE_CONFIRM_EMAILS=false → values should be equal (modulo timestamp
    // normalization, but pg returns timestamptz as string consistently).
    const oldIso = oldVal ? new Date(oldVal).toISOString() : null;
    const prodIso = prodVal ? new Date(prodVal).toISOString() : null;
    if (oldIso !== prodIso) unexpectedly_changed++;
  }
  return { force_confirm_emails: forceConfirmEmails, unexpectedly_changed, forced_count };
}

/**
 * For every (id) in OLD auth.users export, look up PROD auth.users and
 * compare encrypted_password via sha256. Hashes themselves are never read
 * outside this scope.
 */
async function comparePasswords(client, ndjsonPath) {
  const result = { match: 0, mismatch: 0, missing_in_prod: 0, both_null: 0, total: 0 };
  for await (const row of readNdjson(ndjsonPath)) {
    result.total++;
    const { rows } = await client.query(
      `SELECT encrypted_password FROM auth.users WHERE id = $1`,
      [row.id]
    );
    const prodPw = rows[0]?.encrypted_password ?? null;
    if (rows.length === 0) {
      result.missing_in_prod++;
      continue;
    }
    if (row.encrypted_password == null && prodPw == null) {
      result.both_null++;
      continue;
    }
    if (compareEncryptedPasswords(row.encrypted_password, prodPw)) {
      result.match++;
    } else {
      result.mismatch++;
    }
  }
  return result;
}

function writeReport(report) {
  const path = 'docs/old-to-prod/AUTH_VERIFY_RESULT.md';
  const lines = [
    '# Auth verify result: OLD → PROD',
    '',
    `> Generated by 08_verify_auth.mjs at ${report.generated_at}.`,
    `> Encrypted password hashes are NEVER printed — only aggregate counts.`,
    '',
    `## Status: **${report.status}**`,
    '',
    '## Counts (strict equality)',
    '',
    `Rule: PROD \`auth.users\` count MUST EQUAL OLD count. PROD \`auth.identities\` MUST EQUAL \`OLD + bootstrap.created\` where \`bootstrap.created = ${report.counts.bootstrap_created}\` (from \`import_state.bootstrapped_identities\`).`,
    '',
    '| Object | OLD | Bootstrap | Expected PROD | Actual PROD | OK |',
    '|---|---:|---:|---:|---:|---|',
    `| auth.users      | ${report.counts.old.auth_users} | — | ${report.counts.old.auth_users} | ${report.counts.prod.auth_users} | ${report.counts.ok_users ? '✓' : '✗'} |`,
    `| auth.identities | ${report.counts.old.identities} | ${report.counts.bootstrap_created} | ${report.counts.expected_prod_identities} | ${report.counts.prod.identities} | ${report.counts.ok_identities ? '✓' : '✗'} |`,
    '',
    '## Set comparison (id / email / identities.user_id)',
    '',
    report.set_comparison
      ? [
          '| Set | OLD | PROD | Equal |',
          '|---|---:|---:|---|',
          `| auth.users.id | ${report.set_comparison.counts.old_users} | ${report.set_comparison.counts.prod_users} | ${report.set_comparison.ids_equal ? '✓' : '✗'} |`,
          `| auth.users.email | ${report.set_comparison.counts.old_emails} | ${report.set_comparison.counts.prod_emails} | ${report.set_comparison.emails_equal ? '✓' : '✗'} |`,
          `| auth.identities.user_id | ${report.set_comparison.counts.old_identities_user_ids} | ${report.set_comparison.counts.prod_identities_user_ids} | ${report.set_comparison.identities_user_ids_equal ? '✓' : '✗'} |`,
          '',
          '### Deltas',
          '',
          `- ids missing in PROD: **${report.set_comparison.deltas.ids_missing_in_prod}**`,
          `- ids extra in PROD: **${report.set_comparison.deltas.ids_extra_in_prod}**`,
          `- emails missing in PROD: **${report.set_comparison.deltas.emails_missing_in_prod}**`,
          `- emails extra in PROD: **${report.set_comparison.deltas.emails_extra_in_prod}**`,
          `- identity user_ids missing in PROD: **${report.set_comparison.deltas.identity_users_missing_in_prod}**`,
        ].join('\n')
      : 'Not run.',
    '',
    '## Password byte-to-byte compare',
    '',
    report.password_compare
      ? [
          '| Metric | Count |',
          '|---|---:|',
          `| Total OLD rows | ${report.password_compare.total} |`,
          `| Match | ${report.password_compare.match} |`,
          `| Mismatch | ${report.password_compare.mismatch} |`,
          `| Missing in PROD | ${report.password_compare.missing_in_prod} |`,
          `| Both NULL (OAuth-only) | ${report.password_compare.both_null} |`,
        ].join('\n')
      : 'Not run (auth.users.ndjson missing).',
    '',
    '## Password-user audit',
    '',
    report.password_user_audit
      ? `Every OLD user with a password must have a non-NULL encrypted_password in PROD.\n\n` +
        `- total OLD password users: **${report.password_user_audit.total}**\n` +
        `- OK in PROD: **${report.password_user_audit.ok}**\n` +
        `- missing in PROD: **${report.password_user_audit.missing_in_prod}**\n` +
        `- PROD has NULL but OLD had a password: **${report.password_user_audit.prod_null_but_old_had}**`
      : 'Not run.',
    '',
    '## OAuth-only audit',
    '',
    report.oauth_only_audit
      ? `OLD users with NULL encrypted_password must remain password-less in PROD.\n\n` +
        `- total OLD OAuth-only users: **${report.oauth_only_audit.total}**\n` +
        `- OK in PROD: **${report.oauth_only_audit.ok}**\n` +
        `- accidentally became password users: **${report.oauth_only_audit.accidentally_password}**`
      : 'Not run.',
    '',
    '## Bootstrap identities',
    '',
    report.bootstrap_audit
      ? `- bootstrap-created identities recorded in import_state: **${report.bootstrap_audit.created}**\n` +
        `- duplicate (provider, provider_id) pairs in PROD: **${report.bootstrap_audit.duplicate_provider_pairs}**\n` +
        (report.bootstrap_audit.duplicate_provider_pairs > 0
          ? `\n> Sample duplicates: ${report.bootstrap_audit.duplicate_provider_pairs_sample.join(', ')}`
          : '')
      : 'Not run.',
    '',
    '## Email-confirmation policy audit',
    '',
    report.confirm_audit
      ? `- FORCE_CONFIRM_EMAILS at import time: **${report.confirm_audit.force_confirm_emails}**\n` +
        (report.confirm_audit.force_confirm_emails
          ? `- users whose email_confirmed_at was forced to now(): **${report.confirm_audit.forced_count}**`
          : `- unexpectedly changed email_confirmed_at: **${report.confirm_audit.unexpectedly_changed}** (must be 0 when FORCE_CONFIRM_EMAILS=false)`)
      : 'Not run.',
    '',
    '## Generated columns in auth.identities',
    '',
    report.identities_generated_columns
      ? (report.identities_generated_columns.email_is_generated
          ? `- \`auth.identities.email\` on PROD is **GENERATED ALWAYS** (Supabase Auth ≥2023.5).\n` +
            `- Import skipped this column; PostgreSQL computes it from \`identity_data->>'email'\`.\n` +
            `- Drift count (\`email\` ≠ \`lower(identity_data->>'email')\`): **${report.identities_generated_columns.email_drift_count ?? 'n/a'}**` +
            (report.identities_generated_columns.email_drift_count === 0
              ? ' ✓'
              : ' ✗ (schema drift — investigate)') +
            (report.identities_generated_columns.skipped_at_import?.length
              ? `\n- Other generated/identity columns skipped at import: ${report.identities_generated_columns.skipped_at_import.filter((s) => s.name !== 'email').map((s) => '`' + s.name + '` (' + s.reason + ')').join(', ') || '_none_'}`
              : '')
          : '_PROD does not flag `auth.identities.email` as GENERATED. Import wrote it explicitly._')
      : '_Audit not run._',
    '',
    '## Clean-auth context (echo from import_state.clean_auth)',
    '',
    report.clean_auth_context
      ? `- executed: **${report.clean_auth_context.executed ? 'YES' : 'NO (dry-run)'}**\n` +
        `- tables cleaned (deletion order): ${report.clean_auth_context.order.map((t) => '`' + t + '`').join(' → ') || '_none_'}\n` +
        `- total rows deleted: **${report.clean_auth_context.deleted_total}**\n\n` +
        `> Auth-cutover semantics:\n` +
        `> - auth.sessions / auth.refresh_tokens were NOT re-imported from OLD.\n` +
        `> - All OLD Supabase sessions are invalidated; users must log in again.\n` +
        `> - Password hashes were re-uploaded from OLD; users keep their OLD password.`
      : '_clean-auth was not requested for this import._',
    '',
    '## Smoke login',
    '',
    report.smoke_login
      ? `- email_masked: \`${report.smoke_login.email_masked}\`\n- ok: ${report.smoke_login.ok ? '✓' : '✗'}` +
        (report.smoke_login.user_id ? `\n- user_id: \`${report.smoke_login.user_id}\`` : '') +
        (report.smoke_login.error ? `\n- error: ${report.smoke_login.error}` : '')
      : 'Skipped (MIGRATION_SMOKE_EMAIL/PASSWORD/PROD URL/anon-key not all set).',
    '',
    '## Go BFF /api/v1/me',
    '',
    report.go_bff_me
      ? `- ok: ${report.go_bff_me.ok ? '✓' : '✗'}` +
        (report.go_bff_me.role_code ? `\n- role_code: \`${report.go_bff_me.role_code}\`` : '') +
        (report.go_bff_me.access_status ? `\n- access_status: \`${report.go_bff_me.access_status}\`` : '') +
        (report.go_bff_me.error ? `\n- error: ${report.go_bff_me.error}` : '')
      : 'Skipped (GO_BFF_BASE_URL not set or smoke login failed).',
    '',
  ];
  if (report.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  lines.push(`Final status: **${report.status}**`);
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  console.log(`✓ wrote ${path}`);
}

main().catch((e) => fatal(e));
