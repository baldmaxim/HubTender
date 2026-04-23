#!/usr/bin/env node
// Compare row counts between old prod and new pre-prod after data import.
// Runs one SELECT COUNT per table on each DB and reports per-table diff.
//
// Uses direct psql (via Docker pgclient:local) — no MCP needed, works offline.
//
// Usage: node scripts/cutover/verify_rowcounts.mjs
// Env:   OLD_PROD_DATABASE_URL, NEW_PREPROD_DATABASE_URL

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadDotenv() {
  for (const name of ['.env', '.env.local']) {
    try {
      const raw = readFileSync(join(process.cwd(), name), 'utf8');
      for (const line of raw.split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (!m) continue;
        if (process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
      }
    } catch { /* absent */ }
  }
}
loadDotenv();

const TABLES_PUBLIC = [
  'tenders', 'client_positions', 'boq_items', 'boq_items_audit',
  'cost_redistribution_results', 'user_position_filters',
  'material_names', 'work_names', 'materials_library', 'works_library',
  'construction_cost_volumes', 'comparison_notes', 'template_items', 'templates',
  'subcontract_growth_exclusions', 'tender_markup_percentage',
  'project_monthly_completion', 'detail_cost_categories', 'user_tasks',
  'import_sessions', 'tender_group_members', 'project_additional_agreements',
  'tender_registry', 'users', 'units', 'tender_groups', 'cost_categories',
  'tender_pricing_distribution', 'markup_parameters', 'projects', 'roles',
  'tender_notes', 'tender_insurance', 'construction_scopes', 'tender_statuses',
  'library_folders', 'markup_tactics', 'tender_documents', 'notifications',
  'tender_iterations',
];
const TABLES_AUTH = ['users', 'identities'];

function count(dbUrl, schema, table) {
  const cmd = `docker run --rm -e DB_URL=${JSON.stringify(dbUrl)} pgclient:local 'psql "$DB_URL" -A -t -c "SELECT COUNT(*) FROM ${schema}.${table};"'`;
  try {
    return parseInt(execSync(cmd, { encoding: 'utf8' }).trim(), 10);
  } catch (e) {
    return NaN;
  }
}

const old = process.env.OLD_PROD_DATABASE_URL;
const neo = process.env.NEW_PREPROD_DATABASE_URL;
if (!old || !neo) {
  console.error('Missing OLD_PROD_DATABASE_URL or NEW_PREPROD_DATABASE_URL');
  process.exit(2);
}

let mismatches = 0;
console.log('schema.table'.padEnd(40), 'old'.padStart(10), 'new'.padStart(10), 'delta'.padStart(10));
console.log('-'.repeat(74));

for (const schemaTables of [['public', TABLES_PUBLIC], ['auth', TABLES_AUTH]]) {
  const [schema, tables] = schemaTables;
  for (const t of tables) {
    const o = count(old, schema, t);
    const n = count(neo, schema, t);
    const delta = isNaN(o) || isNaN(n) ? 'ERR' : n - o;
    const label = `${schema}.${t}`.padEnd(40);
    const mark = delta === 0 ? '✓' : '✗';
    console.log(mark, label, String(o).padStart(8), String(n).padStart(10), String(delta).padStart(10));
    if (delta !== 0) mismatches++;
  }
}

console.log('-'.repeat(74));
if (mismatches === 0) {
  console.log('✓ All row counts match.');
  process.exit(0);
} else {
  console.log(`✗ ${mismatches} table(s) mismatch.`);
  process.exit(1);
}
