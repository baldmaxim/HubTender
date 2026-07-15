// Stage 0.1.2.2c source guard — run via tsx:
//   npx tsx scripts/checks/noCommercialSqlRpc.check.mjs
//
// public.bulk_update_boq_items_commercial_costs(jsonb) is RETIRED: a fail-closed
// tombstone that always raises SQLSTATE 0A000 COMMERCIAL_COST_WRITE_RETIRED and
// can never mutate boq_items. This guard fails if:
//
//   1. the canonical fresh-install definition (db/yandex/sql/04_functions.sql)
//      stops being a tombstone — mutation SQL, jsonb parsing, SECURITY DEFINER,
//      STRICT, missing retired marker, missing REVOKE FROM PUBLIC;
//   2. the incremental retirement migration loses its tombstone / ACL revoke /
//      transactional structure, or grows a mutation body;
//   3. production Go/TS code calls the RPC again (any invocation form).
//
// Allowed references: the generated type declaration (database.types.ts — a
// reflection of the DB signature, not a permission to call), docs, archive,
// the retirement migration itself, tests that verify the retirement, and this
// guard. A production helper/caller is NOT excusable.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const FN = 'bulk_update_boq_items_commercial_costs';
const CANONICAL = 'db/yandex/sql/04_functions.sql';
const MIGRATION = 'db/yandex/incremental/2026_07_retire_bulk_update_commercial_costs.sql';

const violations = [];
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

function read(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push(`${rel} — file missing (guard must be kept in sync)`);
    return null;
  }
  return readFileSync(abs, 'utf8');
}

// extractDefinition returns the full CREATE OR REPLACE FUNCTION … $function$;
// block for FN inside an SQL file (comments included as written).
function extractDefinition(sql, rel) {
  const startRe = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${FN}\\s*\\(`, 'i');
  const m = startRe.exec(sql);
  if (!m) {
    violations.push(`${rel} — definition of public.${FN} not found`);
    return null;
  }
  const end = sql.indexOf('$function$;', m.index);
  if (end < 0) {
    violations.push(`${rel}:${lineOf(sql, m.index)} — unterminated function body`);
    return null;
  }
  return { text: sql.slice(m.index, end + '$function$;'.length), at: m.index };
}

// checkTombstone validates one SQL definition of the RPC as a fail-closed
// tombstone. surrounding = full file text (for REVOKE checks near it).
function checkTombstone(rel, sql) {
  const def = extractDefinition(sql, rel);
  if (!def) return;
  const d = def.text;
  const at = lineOf(sql, def.at);

  const mustContain = [
    [/COMMERCIAL_COST_WRITE_RETIRED/, 'retired error marker COMMERCIAL_COST_WRITE_RETIRED'],
    [/ERRCODE\s*=\s*'0A000'/i, "stable SQLSTATE (ERRCODE = '0A000')"],
    [/SECURITY\s+INVOKER/i, 'SECURITY INVOKER'],
    [/CALLED\s+ON\s+NULL\s+INPUT/i, 'CALLED ON NULL INPUT (NULL must not bypass the tombstone)'],
    [/SET\s+search_path/i, 'pinned search_path'],
  ];
  for (const [re, what] of mustContain) {
    if (!re.test(d)) violations.push(`${rel}:${at} — tombstone must contain ${what}`);
  }

  const mustNotContain = [
    [/\bUPDATE\s+(public\.)?boq_items\b/i, 'UPDATE boq_items (mutation body)'],
    [/\bINSERT\s+INTO\s+(public\.)?boq_items\b/i, 'INSERT INTO boq_items'],
    [/\bDELETE\s+FROM\s+(public\.)?boq_items\b/i, 'DELETE FROM boq_items'],
    [/jsonb_to_recordset|jsonb_array_elements/i, 'payload parsing (tombstone must fail before reading p_rows)'],
    [/SECURITY\s+DEFINER/i, 'SECURITY DEFINER'],
    [/^\s*STRICT\s*$|\bRETURNS\s+NULL\s+ON\s+NULL\s+INPUT\b/im, 'STRICT / RETURNS NULL ON NULL INPUT'],
    [/recalculate_tender_grand_total/i, 'grand-total recalc call (no side effects)'],
  ];
  for (const [re, what] of mustNotContain) {
    const mm = re.exec(d);
    if (mm) violations.push(`${rel}:${at + lineOf(d, mm.index) - 1} — tombstone must NOT contain ${what}`);
  }

  // ACL step must accompany the definition in the same file.
  const revokeRe = new RegExp(
    `REVOKE\\s+ALL\\s+PRIVILEGES\\s+ON\\s+FUNCTION\\s+public\\.${FN}\\s*\\(jsonb\\)\\s+FROM\\s+PUBLIC`, 'is');
  if (!revokeRe.test(sql)) {
    violations.push(`${rel} — missing REVOKE ALL PRIVILEGES … FROM PUBLIC for public.${FN}(jsonb)`);
  }
}

// ─── 1. canonical fresh-install definition ───────────────────────────────────
{
  const sql = read(CANONICAL);
  if (sql != null) checkTombstone(CANONICAL, sql);
}

// ─── 2. incremental retirement migration ─────────────────────────────────────
{
  const sql = read(MIGRATION);
  if (sql != null) {
    checkTombstone(MIGRATION, sql);
    if (!/^\s*BEGIN;/m.test(sql) || !/^\s*COMMIT;/m.test(sql)) {
      violations.push(`${MIGRATION} — migration must be transactional (BEGIN; … COMMIT;)`);
    }
    if (!/aclexplode/i.test(sql)) {
      violations.push(`${MIGRATION} — migration must revoke EXECUTE from discovered non-owner grantees (aclexplode loop)`);
    }
  }
}

// ─── 3. no production caller in Go / TS ──────────────────────────────────────
const SCAN_DIRS = ['src', 'backend', 'scripts'];
const ALLOWED = new Set([
  'src/lib/types/database.types.ts',            // generated reflection of the DB signature
  'scripts/checks/noCommercialSqlRpc.check.mjs', // this guard
  'scripts/checks/noCommercialWrite.check.mjs',  // sibling guard may name the RPC in rules
]);
const EXT = new Set(['.ts', '.tsx', '.go', '.mjs', '.js', '.sql']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'archive') continue;
      yield* walk(abs);
    } else if (EXT.has(name.slice(name.lastIndexOf('.')))) {
      yield abs;
    }
  }
}

for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (ALLOWED.has(rel)) continue;
    if (/_test\.go$/.test(rel)) continue; // retirement-verification tests may name the RPC
    if (rel === 'backend/internal/readiness/acl.go') continue; // 2.4: read-only ACL verifier names the RPC, never calls it
    const text = readFileSync(file, 'utf8');
    const i = text.indexOf(FN);
    if (i >= 0) {
      violations.push(`${rel}:${lineOf(text, i)} — production code references the retired RPC ${FN}`);
    }
  }
}

console.log('noCommercialSqlRpc.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: the legacy commercial-cost SQL RPC must stay a fail-closed tombstone.');
  console.error('    The only production writer is PersistCalculatedCommercialCosts (internal, Go).\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log(`  ok — canonical definition of ${FN} is a fail-closed tombstone (0A000, INVOKER, not STRICT)`);
console.log('  ok — retirement migration keeps tombstone + PUBLIC/non-owner ACL revoke, transactional');
console.log('  ok — no production Go/TS caller of the retired RPC');
console.log('\nnoCommercialSqlRpc.check: passed');
