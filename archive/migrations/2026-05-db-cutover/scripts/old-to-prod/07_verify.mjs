#!/usr/bin/env node
// 07_verify — post-import data consistency check on PROD.
//
// Read-only against PROD. Compares row counts vs OLD manifest, runs 11 FK
// integrity checks, writes docs/old-to-prod/VERIFY_RESULT.md.
//
// Exit codes:
//   0 = VERIFY_OK or VERIFY_OK_WITH_WARNINGS
//   1 = VERIFY_FAILED
//   2 = missing prerequisites

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadDotenv, requireEnv, getClient, tag, parseCliArgs,
  requireExportFiles, fatal, assertTemporalRawParsers,
} from './_lib.mjs';
import { IMPORT_ORDER } from './_tables.mjs';
import {
  FK_CHECKS, CHECKSUM_TABLES, STRICT_BUSINESS_TABLES, allowsPreexistingRows,
} from './_mapping.mjs';
import { countRows, defaultOrderBy } from './_copy.mjs';
import { tableChecksumSql, chunkedTableChecksum, HEAVY_CHECKSUM_CHUNK } from './_checksums.mjs';

loadDotenv();

const { values } = parseCliArgs({
  name: '07_verify.mjs',
  description: 'Verify PROD row counts and FK consistency after import.',
  options: {
    'dry-run':    { type: 'boolean', default: false, describe: 'Probe only; do not write VERIFY_RESULT.md' },
    'export-dir': { type: 'string',  default: '',    describe: 'Override EXPORT_DIR env' },
  },
});

const exportDir = values['export-dir'] || process.env.EXPORT_DIR || './.old-to-prod-export';
const dryRun = values['dry-run'];

async function main() {
  requireExportFiles(exportDir, ['manifest.json'], 'Run :export first.');

  const prodUrl = requireEnv('PROD_SUPABASE_DB_URL');
  const manifest = JSON.parse(readFileSync(join(exportDir, 'manifest.json'), 'utf8'));

  // Read import_state to surface in-import PK de-duplication, which is a
  // status-affecting condition (hard FAIL unless the rehearsal 2-key guard
  // is set in 06_import_prod).
  const importStatePath = join(exportDir, 'import_state.json');
  const importState = existsSync(importStatePath)
    ? JSON.parse(readFileSync(importStatePath, 'utf8'))
    : {};
  const droppedDuplicates = importState.dropped_duplicates ?? {};
  const droppedTotal = Object.values(droppedDuplicates).reduce((a, b) => a + b, 0);
  const allowImportDedupEnv = process.env.ALLOW_IMPORT_DEDUP_FOR_REHEARSAL === 'true';

  console.log(`${tag('PROD')} connecting${dryRun ? ' (dry-run)' : ''}…`);
  const client = await getClient(prodUrl);

  // The md5(string_agg(t::text)) checksum is computed server-side; its
  // timestamptz rendering depends on the session TimeZone/DateStyle. getClient
  // pins UTC + ISO and raw parsers; assert it took effect so the PROD checksum
  // is comparable to the OLD manifest checksum (same root cause as VERIFY_FAILED).
  const temporalCheck = await assertTemporalRawParsers(client);
  console.log(`${tag('PROD')} temporal session ✓ (UTC, ISO, raw parsers — tstz=${temporalCheck.timestamptz})`);

  const report = {
    generated_at: new Date().toISOString(),
    row_counts: [],
    checksums: [],
    fk_violations: [],
    orphan_checks: [],
    registry_duplicates: null,
    audit_delta: null,
    dropped_duplicates: { per_table: droppedDuplicates, total: droppedTotal, rehearsal_env: allowImportDedupEnv },
    warnings: [],
    status: 'PENDING',
  };

  try {
    // ---- Row counts (strict extra-rows policy) ----
    //
    // For every imported table we check:
    //   - prod >= old  (otherwise missing rows; always FAIL)
    //   - prod <= old  unless the table is in ALLOW_PREEXISTING_ROWS_TABLES.
    //     For business tables (STRICT_BUSINESS_TABLES) extra rows in PROD
    //     beyond OLD count are a hard failure — they indicate either
    //     incomplete cleanup, an unintended trigger insert (auto_create_*,
    //     log_*) or polluted PROD.
    //   - For reference/seed/template tables, extra rows are tolerated and
    //     downgraded to a warning.
    const strictBusiness = new Set(STRICT_BUSINESS_TABLES);
    for (const table of IMPORT_ORDER) {
      const oldRows = manifest.row_counts?.[`public.${table}`] ?? null;
      let prodRows = null;
      try {
        prodRows = await countRows(client, 'public', table);
      } catch {
        report.warnings.push(`public.${table}: count failed (table missing on PROD?)`);
        continue;
      }

      const missing = oldRows != null && prodRows < oldRows;
      const extra = oldRows != null && prodRows > oldRows;
      const isStrict = strictBusiness.has(table);
      const isAllowedPreexisting = allowsPreexistingRows(table);

      let ok, severity, note;
      if (missing) {
        ok = false; severity = 'FAIL'; note = `missing ${oldRows - prodRows} rows in PROD`;
      } else if (extra && isStrict && !isAllowedPreexisting) {
        ok = false; severity = 'FAIL'; note = `PROD has ${prodRows - oldRows} extra rows; business table requires PROD == OLD`;
      } else if (extra && isAllowedPreexisting) {
        ok = true; severity = 'WARN'; note = `PROD has ${prodRows - oldRows} preexisting rows (table allows preexisting)`;
      } else if (extra) {
        // Non-strict, non-allowed-preexisting → warn (rare; legacy ref tables)
        ok = true; severity = 'WARN'; note = `PROD has ${prodRows - oldRows} extra rows`;
      } else {
        ok = true; severity = 'OK'; note = null;
      }

      report.row_counts.push({ table, old: oldRows, prod: prodRows, ok, severity, note });
      const mark = severity === 'FAIL' ? '✗' : severity === 'WARN' ? '⚠' : '✓';
      console.log(`${tag('PROD')} ${mark} public.${table}: old=${oldRows ?? '-'} prod=${prodRows}${note ? ' — ' + note : ''}`);
    }

    // ---- FK consistency ----
    for (const fk of FK_CHECKS) {
      const sql = `
        SELECT COUNT(*)::int AS n
          FROM public.${qIdent(fk.table)} c
          LEFT JOIN public.${qIdent(fk.refTable)} p ON p.${qIdent(fk.refColumn)} = c.${qIdent(fk.column)}
         WHERE c.${qIdent(fk.column)} IS NOT NULL AND p.${qIdent(fk.refColumn)} IS NULL
      `;
      try {
        const { rows: [{ n }] } = await client.query(sql);
        const ok = n === 0;
        report.fk_violations.push({
          fk: `${fk.table}.${fk.column} → ${fk.refTable}.${fk.refColumn}`,
          orphans: n,
          ok,
        });
        const mark = ok ? '✓' : '✗';
        console.log(`${tag('PROD')} ${mark} FK ${fk.table}.${fk.column} → ${fk.refTable}.${fk.refColumn}: ${n} orphans`);
      } catch (e) {
        report.warnings.push(`FK ${fk.table}.${fk.column}: query failed: ${e.message}`);
      }
    }

    // ---- Orphan public.users / auth.users ----
    try {
      const { rows: [a] } = await client.query(`
        SELECT COUNT(*)::int AS n FROM public.users pu
        LEFT JOIN auth.users au ON au.id = pu.id WHERE au.id IS NULL
      `);
      report.orphan_checks.push({ name: 'public.users without auth.users', orphans: a.n, ok: a.n === 0 });
      const { rows: [b] } = await client.query(`
        SELECT COUNT(*)::int AS n FROM auth.users au
        LEFT JOIN public.users pu ON pu.id = au.id WHERE pu.id IS NULL
      `);
      report.orphan_checks.push({ name: 'auth.users without public.users', orphans: b.n, ok: true });
      // Auth orphans are tolerated — system/internal users.
      console.log(`${tag('PROD')} orphans: public→auth=${a.n}, auth→public=${b.n}`);
    } catch (e) {
      report.warnings.push(`orphan check failed: ${e.message}`);
    }

    // ---- Per-table checksums (FAIL on mismatch when counts equal) ----
    const manifestByTable = new Map(
      (manifest.tables ?? []).map((t) => [`${t.schema}.${t.table}`, t])
    );
    for (const table of CHECKSUM_TABLES) {
      const manifestEntry = manifestByTable.get(`public.${table}`);
      if (!manifestEntry) {
        report.warnings.push(`public.${table}: not in manifest, skipping checksum`);
        continue;
      }
      const oldChecksum = manifestEntry.sql_checksum ?? null;
      const oldRows = manifestEntry.rows ?? 0;
      const prodRows = report.row_counts.find((r) => r.table === table)?.prod ?? null;

      let status = 'unknown';
      let note = null;

      if ((oldRows ?? 0) === 0 && (prodRows ?? 0) === 0) {
        // Empty on both sides — nothing to checksum, this is a clean MATCH
        // (NOT a warning). Covers notifications / tender_iterations 0/0.
        status = 'match';
        note = 'empty (0 rows) — OLD == PROD';
        report.checksums.push({ table, status, note });
        console.log(`${tag('PROD')} ✓ checksum public.${table}: ${status} — ${note}`);
        continue;
      }

      let prodChecksum = null;
      try {
        const orderBy = defaultOrderBy(table);
        if (manifestEntry.sql_checksum_mode === 'chunked') {
          // Recompute with the SAME partitioning the export used.
          prodChecksum = await chunkedTableChecksum(client, {
            schema: 'public', table, orderBy,
            chunkSize: manifestEntry.sql_checksum_chunk_size || HEAVY_CHECKSUM_CHUNK,
          });
        } else {
          const { rows: [c] } = await client.query(tableChecksumSql('public', table, orderBy));
          prodChecksum = c?.checksum ?? null;
        }
      } catch (e) {
        // Strict: a checksum we cannot compute is a FAILURE, never a warning.
        status = 'mismatch';
        note = `PROD checksum compute failed (${e.message}) — cannot verify integrity`;
        report.checksums.push({ table, status, note });
        console.log(`${tag('PROD')} ✗ checksum public.${table}: ${status} — ${note}`);
        continue;
      }

      if (!oldChecksum) {
        // Non-empty table with no OLD checksum cannot be verified → FAIL
        // (strict: re-export with the current 04_export_old).
        status = 'mismatch';
        note = 'no OLD checksum in manifest for a non-empty table — re-run :export';
      } else if (oldChecksum === prodChecksum) {
        status = 'match';
      } else if (prodRows != null && oldRows != null && prodRows > oldRows) {
        // PROD has pre-existing rows beyond OLD (seed/template tables allowed
        // preexisting); full-table checksum equality is impossible — WARN.
        status = 'preexisting_rows';
        note = `PROD has ${prodRows - oldRows} pre-existing rows; full-table checksum match not expected`;
      } else {
        // Raw json/jsonb parsers make jsonb byte-deterministic OLD↔PROD, so a
        // mismatch is a REAL data difference — no jsonb_warning downgrade.
        status = 'mismatch';
        note = 'PROD content differs from OLD export';
      }
      report.checksums.push({ table, status, note });
      const mark =
        status === 'match' ? '✓' :
        status === 'mismatch' ? '✗' :
        '⚠';
      console.log(`${tag('PROD')} ${mark} checksum public.${table}: ${status}${note ? ' — ' + note : ''}`);
    }

    // ---- Registry duplicate check ----
    // After importing tenders with the trigger disabled, no new registry
    // duplicates should appear vs what already existed in OLD.
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
      const oldDup = manifest.tender_registry_duplicates ?? { by_tender_number: 0, by_title_client_area: 0 };
      const prodDup = { by_tender_number: r.by_tender_number, by_title_client_area: r.by_title_client_area };
      const ok =
        prodDup.by_tender_number <= oldDup.by_tender_number &&
        prodDup.by_title_client_area <= oldDup.by_title_client_area;
      report.registry_duplicates = { old: oldDup, prod: prodDup, ok };
      const mark = ok ? '✓' : '✗';
      console.log(
        `${tag('PROD')} ${mark} tender_registry duplicates: ` +
        `by_tender_number old=${oldDup.by_tender_number} prod=${prodDup.by_tender_number} | ` +
        `by_title_client_area old=${oldDup.by_title_client_area} prod=${prodDup.by_title_client_area}`,
      );
    } catch (e) {
      report.warnings.push(`registry duplicate check failed: ${e.message}`);
    }

    // ---- boq_items_audit delta check ----
    // trg_boq_items_audit may have inflated PROD audit count if disable failed.
    try {
      const oldAuditRows = manifest.row_counts?.['public.boq_items_audit'] ?? 0;
      const { rows: [a] } = await client.query(`SELECT COUNT(*)::int AS n FROM public.boq_items_audit`);
      const prodAuditRows = a.n;
      // If we imported all the boq_items_audit rows AND no trigger fired,
      // prodAuditRows should be ≤ oldAuditRows + preexisting PROD audit rows.
      // We assume preexisting = 0 for empty-import case; otherwise warn.
      const expectedMax = oldAuditRows; // best estimate; preexisting handled as warning below
      const inflation = prodAuditRows - expectedMax;
      const ok = inflation <= 0;
      report.audit_delta = {
        old: oldAuditRows,
        prod: prodAuditRows,
        inflation,
        ok,
      };
      if (!ok) {
        const expectedBoqItems = manifest.row_counts?.['public.boq_items'] ?? 0;
        if (inflation === expectedBoqItems) {
          report.audit_delta.note =
            `Inflation exactly matches imported boq_items count (${expectedBoqItems}) — ` +
            `trg_boq_items_audit fired during import. Re-import with ALLOW_DISABLE_IMPORT_TRIGGERS=true.`;
        } else {
          report.audit_delta.note =
            `PROD has ${inflation} more audit rows than OLD export — possible pre-existing PROD audit data; review manually.`;
        }
      }
      const mark = ok ? '✓' : '✗';
      console.log(`${tag('PROD')} ${mark} boq_items_audit: old=${oldAuditRows} prod=${prodAuditRows} inflation=${inflation}`);
    } catch (e) {
      report.warnings.push(`audit delta check failed: ${e.message}`);
    }

    // ---- Status ----
    const hasFkFail = report.fk_violations.some((c) => !c.ok);
    const hasCountFail = report.row_counts.some((c) => !c.ok);
    const hasOrphanFail = report.orphan_checks.some((c) => !c.ok);
    const hasChecksumMismatch = report.checksums.some((c) => c.status === 'mismatch');
    const hasRegistryDup = report.registry_duplicates && !report.registry_duplicates.ok;
    const hasAuditInflation = report.audit_delta && !report.audit_delta.ok;
    const hasChecksumWarning = report.checksums.some(
      (c) => c.status === 'jsonb_warning' || c.status === 'preexisting_rows' || c.status === 'skipped',
    );
    const hasCountWarning = report.row_counts.some((c) => c.severity === 'WARN');

    // Dropped duplicates from in-import dedup: hard FAIL by default; downgrade
    // to OK_WITH_WARNINGS only if rehearsal 2-key guard satisfied at import
    // time (we read ALLOW_IMPORT_DEDUP_FOR_REHEARSAL here for the env half,
    // and assume the CLI half was true at import time when the importer
    // actually proceeded — 06_import_prod throws otherwise).
    const hasDroppedDuplicates = droppedTotal > 0;
    const dropsAllowedByRehearsal = hasDroppedDuplicates && allowImportDedupEnv;

    if (hasFkFail || hasCountFail || hasOrphanFail || hasChecksumMismatch || hasRegistryDup || hasAuditInflation) {
      report.status = 'VERIFY_FAILED';
    } else if (hasDroppedDuplicates && !dropsAllowedByRehearsal) {
      report.status = 'VERIFY_FAILED';
      report.warnings.push(
        `${droppedTotal} duplicate PK(s) were dropped during import without the rehearsal 2-key guard. ` +
        `Re-export OLD via REPEATABLE READ snapshot (default in 04_export_old).`,
      );
    } else if (report.warnings.length > 0 || hasChecksumWarning || hasCountWarning || hasDroppedDuplicates) {
      report.status = 'VERIFY_OK_WITH_WARNINGS';
      if (hasDroppedDuplicates) {
        report.warnings.push(
          `${droppedTotal} duplicate PK(s) were dropped during import under rehearsal mode ` +
          `(ALLOW_IMPORT_DEDUP_FOR_REHEARSAL=true). Status downgraded from VERIFY_OK.`,
        );
      }
    } else {
      report.status = 'VERIFY_OK';
    }

    if (!dryRun) {
      writeReport(report);
    }
    console.log(`${tag('PROD')} status: ${report.status}`);

    if (report.status === 'VERIFY_FAILED') process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

function qIdent(s) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error(`unsafe identifier: ${s}`);
  return `"${s}"`;
}

function writeReport(report) {
  const path = 'docs/old-to-prod/VERIFY_RESULT.md';
  const lines = [
    '# Verify result: OLD → PROD',
    '',
    `> Generated by 07_verify.mjs at ${report.generated_at}.`,
    `> This file is regenerated on every run.`,
    '',
    `## Status: **${report.status}**`,
    '',
    '## Row counts (strict extra-rows policy)',
    '',
    'Severity legend: **OK** (PROD == OLD); **WARN** (extra rows in PROD, but the table allows preexisting rows — seed/reference/templates); **FAIL** (missing rows OR extra rows in a business table). Business tables require `PROD == OLD`.',
    '',
    '| Table | OLD | PROD | Severity | Note |',
    '|---|---:|---:|---|---|',
  ];
  for (const r of report.row_counts) {
    lines.push(`| public.${r.table} | ${r.old ?? '-'} | ${r.prod} | ${r.severity ?? (r.ok ? 'OK' : 'FAIL')} | ${r.note ?? ''} |`);
  }
  lines.push('');
  lines.push('## FK consistency');
  lines.push('');
  lines.push('| FK | Orphans | OK |');
  lines.push('|---|---:|---|');
  for (const r of report.fk_violations) {
    lines.push(`| \`${r.fk}\` | ${r.orphans} | ${r.ok ? '✓' : '✗'} |`);
  }
  lines.push('');
  lines.push('## Orphan checks');
  lines.push('');
  lines.push('| Check | Orphans | OK |');
  lines.push('|---|---:|---|');
  for (const r of report.orphan_checks) {
    lines.push(`| ${r.name} | ${r.orphans} | ${r.ok ? '✓' : '✗ (tolerated for auth→public)'} |`);
  }

  lines.push('');
  lines.push('## Table checksums (md5 of stable text aggregate)');
  lines.push('');
  lines.push('Computed via `md5(string_agg(t::text, \',\' ORDER BY pk))` on both OLD (at export time) and PROD (here); heavy tables use the equivalent chunked fold with the same partitioning. Raw json/jsonb + temporal parsers + UTC/ISO session make `t::text` byte-deterministic OLD↔PROD. `match` = byte-identical (incl. empty 0/0 tables); `mismatch` = real data drift OR uncomputable checksum (FAIL — no jsonb downgrade); `preexisting_rows` = PROD has rows beyond OLD export, full-table match impossible (WARN, seed/template only).');
  lines.push('');
  lines.push('> `auth.users` is intentionally excluded from this section — its checksum would expose `encrypted_password`. See `08_verify_auth.mjs` for the password-safe row-by-row sha256 path.');
  lines.push('');
  lines.push('| Table | Status | Note |');
  lines.push('|---|---|---|');
  for (const c of report.checksums) {
    const mark = c.status === 'match' ? '✓' : c.status === 'mismatch' ? '✗' : '⚠';
    lines.push(`| public.${c.table} | ${mark} ${c.status} | ${c.note ?? ''} |`);
  }

  if (report.registry_duplicates) {
    const d = report.registry_duplicates;
    lines.push('');
    lines.push('## tender_registry duplicate check');
    lines.push('');
    lines.push('Verifies that `trigger_auto_create_tender_registry` did NOT create extra rows during the `tenders` import. A non-zero increase between OLD and PROD means the trigger fired — re-import with `ALLOW_DISABLE_IMPORT_TRIGGERS=true`.');
    lines.push('');
    lines.push('| Group | OLD | PROD | OK |');
    lines.push('|---|---:|---:|---|');
    lines.push(`| by tender_number | ${d.old.by_tender_number} | ${d.prod.by_tender_number} | ${d.ok ? '✓' : '✗'} |`);
    lines.push(`| by title+client_name+area (where tender_number IS NULL) | ${d.old.by_title_client_area} | ${d.prod.by_title_client_area} | ${d.ok ? '✓' : '✗'} |`);
  }

  if (report.audit_delta) {
    const a = report.audit_delta;
    lines.push('');
    lines.push('## boq_items_audit delta');
    lines.push('');
    lines.push('| Source | Rows |');
    lines.push('|---|---:|');
    lines.push(`| OLD export (boq_items_audit.ndjson) | ${a.old} |`);
    lines.push(`| PROD after import | ${a.prod} |`);
    lines.push(`| Inflation | ${a.inflation} |`);
    if (a.note) lines.push('');
    if (a.note) lines.push(`> ${a.note}`);
  }

  if (report.dropped_duplicates && report.dropped_duplicates.total > 0) {
    lines.push('');
    lines.push('## In-import PK de-duplication (drift detector)');
    lines.push('');
    lines.push(`Total duplicate PKs dropped at import: **${report.dropped_duplicates.total}**`);
    lines.push(`Rehearsal env (\`ALLOW_IMPORT_DEDUP_FOR_REHEARSAL\`): \`${report.dropped_duplicates.rehearsal_env}\``);
    lines.push('');
    lines.push('| Table | Dropped duplicate PKs |');
    lines.push('|---|---:|');
    for (const [tbl, n] of Object.entries(report.dropped_duplicates.per_table)) {
      lines.push(`| \`${tbl}\` | ${n} |`);
    }
    lines.push('');
    lines.push('> Duplicates in NDJSON indicate either pagination drift during a live OLD export or trigger-induced artefacts. The default export path (`04_export_old.mjs`) uses a `REPEATABLE READ READ ONLY` snapshot + keyset pagination, which makes drift impossible. Non-zero counts mean export was run against an inconsistent source — for production cutover, re-export from a frozen OLD.');
  }
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('## Warnings');
    for (const w of report.warnings) lines.push(`- ${w}`);
  }
  lines.push('');
  lines.push(`Final status: **${report.status}**`);
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  console.log(`✓ wrote ${path}`);
}

main().catch((e) => fatal(e));
