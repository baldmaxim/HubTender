#!/usr/bin/env node
// 04_export_old — read-only dump of OLD Supabase into EXPORT_DIR/data/*.ndjson.
//
// Safety: this script never writes to OLD. It does write JSON files (manifest,
// auth_stats) and NDJSON dumps under EXPORT_DIR. No secrets in logs.
//
// Usage: npm run old-to-prod:export -- [--dry-run] [--batch-size=N] [--export-dir=...]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadDotenv, requireEnv, getClient, tag, writeJson, parseCliArgs, fatal,
} from './_lib.mjs';
import { IMPORT_ORDER } from './_tables.mjs';
import {
  streamTable, writeNdjson, countRows, defaultOrderBy,
} from './_copy.mjs';
import {
  loadAuthUsersForExport, loadIdentitiesForExport, collectAuthStats,
} from './_auth.mjs';
import { sha256OfFile, tableChecksumSql, JSONB_TABLES } from './_checksums.mjs';
import { CHECKSUM_TABLES } from './_mapping.mjs';

loadDotenv();

const { values } = parseCliArgs({
  name: '04_export_old.mjs',
  description: 'Read-only export of OLD Supabase to EXPORT_DIR/data/*.ndjson.',
  options: {
    'dry-run':    { type: 'boolean', default: false, describe: 'Probe + counts only; do not write NDJSON' },
    'batch-size': { type: 'string',  default: '1000', describe: 'Page size for streaming SELECT' },
    'export-dir': { type: 'string',  default: '',     describe: 'Override EXPORT_DIR env' },
    'use-mcp-preflight': { type: 'boolean', default: false, describe: 'No-op for export; accepted so users can pass the flag uniformly across all stages' },
  },
});

const exportDir = values['export-dir'] || process.env.EXPORT_DIR || './.old-to-prod-export';
const batchSize = parseInt(values['batch-size'], 10) || 1000;
const dryRun = values['dry-run'];

async function main() {
  const oldUrl = requireEnv('OLD_SUPABASE_DB_URL');
  mkdirSync(join(exportDir, 'data'), { recursive: true });

  console.log(`${tag('OLD')} connecting${dryRun ? ' (dry-run)' : ''}…`);
  const client = await getClient(oldUrl);

  try {
    const { rows: [v] } = await client.query('SELECT version() AS v');
    console.log(`${tag('OLD')} ${v.v.slice(0, 40)}…`);

    const manifest = {
      generated_at: new Date().toISOString(),
      source_db_version: v.v,
      source_label: 'OLD',
      export_format: 'NDJSON',
      dry_run: dryRun,
      tables: [],
      row_counts: {},
      warnings: [
        'auth.sessions and auth.refresh_tokens are intentionally NOT exported. ' +
        'They are tied to the OLD project\'s instance_id and JWT secret. After cutover ' +
        'all users will be force-relogged in via a new PROD session.',
      ],
    };

    const checksumSet = new Set(CHECKSUM_TABLES);

    // ---- Public tables ----
    for (const table of IMPORT_ORDER) {
      const exists = await tableExists(client, 'public', table);
      if (!exists) {
        manifest.warnings.push(`public.${table}: not present in OLD, skipped`);
        console.log(`${tag('OLD')} skip public.${table} (not present)`);
        continue;
      }
      const rowCount = await countRows(client, 'public', table);
      manifest.row_counts[`public.${table}`] = rowCount;

      const ndjsonPath = join(exportDir, 'data', `public.${table}.ndjson`);
      let bytes = 0;
      if (!dryRun && rowCount > 0) {
        const stream = streamTable(client, {
          schema: 'public', table, orderBy: defaultOrderBy(table), batchSize,
        });
        const result = await writeNdjson(ndjsonPath, stream);
        bytes = result.bytes;
      }
      const checksum = dryRun || rowCount === 0 ? null : await sha256OfFile(ndjsonPath);

      // SQL checksum (server-side md5 of stable text aggregate). Used by
      // 07_verify to detect data-content drift even when row counts match.
      let sqlChecksum = null;
      if (!dryRun && rowCount > 0 && checksumSet.has(table)) {
        try {
          const orderBy = defaultOrderBy(table);
          const { rows: [c] } = await client.query(tableChecksumSql('public', table, orderBy));
          sqlChecksum = c?.checksum ?? null;
        } catch (e) {
          manifest.warnings.push(`public.${table}: sql_checksum failed: ${e.message}`);
        }
      }

      manifest.tables.push({
        schema: 'public',
        table,
        rows: rowCount,
        ndjson_bytes: bytes,
        ndjson_path: dryRun ? null : `data/public.${table}.ndjson`,
        checksum_sha256: checksum,
        sql_checksum: sqlChecksum,
        has_jsonb: JSONB_TABLES.has(table),
      });
      const csTag = sqlChecksum ? ' [sql-cs ✓]' : '';
      console.log(`${tag('OLD')} ${rowCount.toString().padStart(8)} public.${table}${dryRun ? ' (dry-run)' : ''}${csTag}`);
    }

    // ---- Auth tables (encrypted_password preserved, NEVER logged) ----
    const authUsersPath = join(exportDir, 'data', 'auth.users.ndjson');
    const authIdentitiesPath = join(exportDir, 'data', 'auth.identities.ndjson');
    let authUsersCount = 0, authIdentitiesCount = 0;
    let authUsersBytes = 0, authIdentitiesBytes = 0;

    if (await tableExists(client, 'auth', 'users')) {
      authUsersCount = await countRows(client, 'auth', 'users');
      if (!dryRun && authUsersCount > 0) {
        const r = await writeNdjson(authUsersPath, loadAuthUsersForExport(client, { batchSize }));
        authUsersBytes = r.bytes;
      }
      manifest.tables.push({
        schema: 'auth',
        table: 'users',
        rows: authUsersCount,
        ndjson_bytes: authUsersBytes,
        ndjson_path: dryRun ? null : 'data/auth.users.ndjson',
        checksum_sha256: dryRun || authUsersCount === 0 ? null : await sha256OfFile(authUsersPath),
        note: 'encrypted_password preserved byte-to-byte; never printed in any log',
      });
      manifest.row_counts['auth.users'] = authUsersCount;
      console.log(`${tag('OLD')} ${authUsersCount.toString().padStart(8)} auth.users${dryRun ? ' (dry-run)' : ''}`);
    }

    if (await tableExists(client, 'auth', 'identities')) {
      authIdentitiesCount = await countRows(client, 'auth', 'identities');
      if (!dryRun && authIdentitiesCount > 0) {
        const r = await writeNdjson(authIdentitiesPath, loadIdentitiesForExport(client, { batchSize }));
        authIdentitiesBytes = r.bytes;
      }
      manifest.tables.push({
        schema: 'auth',
        table: 'identities',
        rows: authIdentitiesCount,
        ndjson_bytes: authIdentitiesBytes,
        ndjson_path: dryRun ? null : 'data/auth.identities.ndjson',
        checksum_sha256: dryRun || authIdentitiesCount === 0 ? null : await sha256OfFile(authIdentitiesPath),
      });
      manifest.row_counts['auth.identities'] = authIdentitiesCount;
      console.log(`${tag('OLD')} ${authIdentitiesCount.toString().padStart(8)} auth.identities${dryRun ? ' (dry-run)' : ''}`);
    }

    // ---- tender_registry baseline duplicates (used by 07_verify) ----
    // Pre-record how many duplicate rows already exist in OLD. PROD must not
    // have MORE than this after import (else trigger_auto_create_tender_registry
    // fired and inflated the table).
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

    // ---- Aggregate auth stats (no PII in log) ----
    const stats = await collectAuthStats(client);
    if (!dryRun) {
      writeJson(join(exportDir, 'auth_stats.json'), {
        generated_at: new Date().toISOString(),
        source_label: 'OLD',
        ...stats,
      });
    }
    console.log(
      `${tag('OLD')} auth_stats: users=${stats.auth_users_count} ` +
      `with_pw=${stats.users_with_encrypted_password} ` +
      `oauth_only=${stats.oauth_only_users_count} ` +
      `orphans=${stats.orphan_auth_users}/${stats.orphan_public_users} ` +
      `dup_emails=${stats.duplicate_emails_in_auth.length}`
    );

    if (!dryRun) {
      writeJson(join(exportDir, 'manifest.json'), manifest);
      console.log(`✓ wrote ${join(exportDir, 'manifest.json')}`);
    } else {
      console.log(`✓ dry-run complete (${manifest.tables.length} tables surveyed)`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function tableExists(client, schema, table) {
  const { rows } = await client.query(
    `SELECT to_regclass($1) AS reg`,
    [`${schema}.${table}`]
  );
  return rows[0]?.reg !== null;
}

main().catch((e) => fatal(e));
