#!/usr/bin/env node
// 10_repair_prod_auth_tokens — coerce NULL GoTrue string-token columns to ''.
//
// Problem: Supabase GoTrue scans auth.users into Go structs where token /
// change columns are non-pointer `string`. A NULL value (even though the
// column is `is_nullable = YES`) makes the row scan fail with
// `converting NULL to string is unsupported` → HTTP 500
// "Database error querying schema" on ANY login.
//
// This script sets every NULL → '' for the columns in
// AUTH_USERS_NOT_NULL_TOKENS that actually exist on PROD auth.users.
//
// Safety:
//   - PROD ONLY (reads PROD_SUPABASE_DB_URL).
//   - Default (no --apply): dry-run; NOTHING is modified.
//   - --apply requires env ALLOW_AUTH_REPAIR=true (two-key guard).
//   - Touches ONLY the listed token/change columns. NEVER reads or writes
//     encrypted_password, email, id, raw_app_meta_data, raw_user_meta_data.
//   - Never prints any column value. Counts only.
//   - Verifies column existence via information_schema before any UPDATE.
//
// Artifacts: docs/old-to-prod/AUTH_REPAIR_RESULT.md

import { writeFileSync } from 'node:fs';

import {
  loadDotenv, requireEnv, getClient, tag, parseCliArgs, fatal,
} from './_lib.mjs';
import { AUTH_USERS_NOT_NULL_TOKENS } from './_mapping.mjs';

loadDotenv();

const { values } = parseCliArgs({
  name: '10_repair_prod_auth_tokens.mjs',
  description: 'Coerce NULL GoTrue string-token columns in PROD auth.users to \'\'.',
  options: {
    'dry-run': { type: 'boolean', default: false, describe: 'Explicit dry-run (this is also the default when --apply is absent)' },
    'apply':   { type: 'boolean', default: false, describe: 'Perform UPDATEs. Requires ALLOW_AUTH_REPAIR=true.' },
  },
});

const apply = values.apply === true;
// Without --apply we never modify anything, regardless of --dry-run.
const dryRun = !apply;

function ident(s) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error(`unsafe identifier: ${s}`);
  return `"${s}"`;
}

async function main() {
  const prodUrl = requireEnv('PROD_SUPABASE_DB_URL');

  // Two-key guard for the destructive path.
  if (apply && process.env.ALLOW_AUTH_REPAIR !== 'true') {
    console.error('✗ --apply requires ALLOW_AUTH_REPAIR=true in scripts/old-to-prod/.env.old-to-prod (or the environment).');
    console.error('  Re-run without --apply for a dry-run, or set the env flag and retry.');
    process.exit(7);
  }

  console.log(`${tag('PROD')} auth-token repair — mode: ${apply ? 'APPLY' : 'DRY-RUN (no writes)'}`);
  const client = await getClient(prodUrl, { applicationName: 'old-to-prod-auth-repair' });

  const report = {
    generated_at: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    candidate_columns: AUTH_USERS_NOT_NULL_TOKENS,
    columns: [],
    total_updated: 0,
    status: 'PENDING',
  };

  try {
    // Which candidate columns actually exist on PROD auth.users?
    const { rows: existing } = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users'
          AND column_name = ANY($1)`,
      [AUTH_USERS_NOT_NULL_TOKENS],
    );
    const existingSet = new Set(existing.map((r) => r.column_name));
    const missing = AUTH_USERS_NOT_NULL_TOKENS.filter((c) => !existingSet.has(c));
    if (missing.length > 0) {
      console.log(`${tag('PROD')} columns not present on PROD auth.users (skipped): ${missing.join(', ')}`);
    }

    for (const col of AUTH_USERS_NOT_NULL_TOKENS) {
      if (!existingSet.has(col)) {
        report.columns.push({ column: col, present: false, null_before: null, updated: 0, null_after: null });
        continue;
      }
      const qcol = ident(col);
      const { rows: [b] } = await client.query(
        `SELECT COUNT(*)::int AS n FROM auth.users WHERE ${qcol} IS NULL`,
      );
      const nullBefore = b.n;

      let updated = 0;
      if (apply && nullBefore > 0) {
        const res = await client.query(
          `UPDATE auth.users SET ${qcol} = '' WHERE ${qcol} IS NULL`,
        );
        updated = res.rowCount ?? 0;
      }

      const { rows: [a] } = await client.query(
        `SELECT COUNT(*)::int AS n FROM auth.users WHERE ${qcol} IS NULL`,
      );
      const nullAfter = a.n;

      report.columns.push({
        column: col,
        present: true,
        null_before: nullBefore,
        updated,
        null_after: nullAfter,
      });
      report.total_updated += updated;

      const mark = nullAfter === 0 ? '✓' : (apply ? '✗' : '·');
      console.log(
        `${tag('PROD')} ${mark} auth.users.${col}: null_before=${nullBefore} ` +
        `updated=${updated} null_after=${nullAfter}` +
        `${!apply && nullBefore > 0 ? ' (dry-run — would set to \'\')' : ''}`,
      );
    }

    // Status: in apply mode, success means every present column has 0 nulls
    // after. In dry-run mode we report PENDING_APPLY when nulls remain.
    const presentCols = report.columns.filter((c) => c.present);
    const stillNull = presentCols.filter((c) => (c.null_after ?? 0) > 0);
    if (apply) {
      report.status = stillNull.length === 0 ? 'REPAIR_OK' : 'REPAIR_FAILED';
    } else {
      const wouldFix = presentCols.filter((c) => (c.null_before ?? 0) > 0);
      report.status = wouldFix.length === 0 ? 'NOTHING_TO_REPAIR' : 'DRY_RUN_PENDING_APPLY';
    }

    writeReport(report);
    console.log(`${tag('PROD')} status: ${report.status} (total_updated=${report.total_updated})`);

    if (report.status === 'REPAIR_FAILED') process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

function writeReport(report) {
  const path = 'docs/old-to-prod/AUTH_REPAIR_RESULT.md';
  const lines = [
    '# Auth token repair result (PROD auth.users)',
    '',
    `> Generated by 10_repair_prod_auth_tokens.mjs at ${report.generated_at}.`,
    `> Mode: **${report.mode}**. Column VALUES are never printed — counts only.`,
    '',
    `## Status: **${report.status}**`,
    '',
    'Coerces NULL → \'\' for GoTrue string token/change columns. A single NULL in any',
    'of these makes GoTrue fail every login with HTTP 500 "Database error querying schema".',
    '',
    '| Column | Present | null_before | updated | null_after |',
    '|---|---|---:|---:|---:|',
  ];
  for (const c of report.columns) {
    lines.push(
      `| \`${c.column}\` | ${c.present ? 'yes' : 'no (skipped)'} | ` +
      `${c.null_before ?? '-'} | ${c.updated ?? 0} | ${c.null_after ?? '-'} |`,
    );
  }
  lines.push('');
  lines.push(`Total rows updated: **${report.total_updated}**`);
  lines.push('');
  if (report.mode === 'dry-run') {
    lines.push('> Dry-run — NO changes were made. To apply:');
    lines.push('> ```powershell');
    lines.push('> $env:ALLOW_AUTH_REPAIR="true"');
    lines.push('> npm run old-to-prod:repair-auth -- --apply');
    lines.push('> ```');
    lines.push('> Then re-verify: `npm run old-to-prod:verify-auth`');
  } else {
    lines.push('> After apply, re-run `npm run old-to-prod:verify-auth` to confirm AUTH_VERIFY_OK.');
  }
  lines.push('');
  lines.push(`Final status: **${report.status}**`);
  try {
    writeFileSync(path, lines.join('\n') + '\n', 'utf8');
    console.log(`✓ wrote ${path}`);
  } catch (e) {
    console.error(`✗ failed to write ${path}: ${e.message}`);
  }
}

main().catch((e) => fatal(e));
