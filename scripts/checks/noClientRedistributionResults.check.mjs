// Stage 0.1.2.3a source guard — run via tsx:
//   npx tsx scripts/checks/noClientRedistributionResults.check.mjs
//
// POST /api/v1/redistributions/save accepts ONLY rules: the client must never
// again send calculated financial values (records / original_work_cost /
// deducted_amount / added_amount / final_work_cost), the backend request DTO
// must not decode them, and the legacy SQL RPC save_redistribution_results
// must stay a fail-closed tombstone (0A000 REDISTRIBUTION_RESULT_WRITE_RETIRED).
//
// Internal response/persistence structs (server-generated results) are allowed —
// the rules below target the REQUEST direction and the SQL writer only.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const violations = [];
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

/** Strip // line comments and /* block *​/ comments, preserving offsets. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

function read(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push(`${rel} — file missing (guard must be kept in sync)`);
    return null;
  }
  return readFileSync(abs, 'utf8');
}

const FINANCIAL = ['records', 'original_work_cost', 'deducted_amount', 'added_amount', 'final_work_cost', 'created_by'];

// ─── 1. frontend: the save request body carries ONLY tender/tactic/rules ─────
{
  const rel = 'src/lib/api/redistributions.ts';
  const code = read(rel);
  if (code != null) {
    const m = /saveRedistributionResults[\s\S]*?body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/.exec(code);
    if (!m) {
      violations.push(`${rel} — save body construction not found (guard must be kept in sync)`);
    } else {
      for (const f of FINANCIAL) {
        if (new RegExp(`\\b${f}\\b`).test(m[1])) {
          violations.push(`${rel}:${lineOf(code, m.index)} — save request body must not contain "${f}"`);
        }
      }
    }
  }
}
{
  const rel = 'src/pages/CostRedistribution/hooks/useSaveResults.ts';
  const raw = read(rel);
  const code = raw == null ? null : stripComments(raw);
  if (code != null) {
    for (const [re, what] of [
      [/fallbackBoqItem/, 'client placeholder (fallbackBoqItem)'],
      [/changedResults/, 'client-side result filtering (changedResults)'],
      [/resultsToPersist/, 'client-selected result subset (resultsToPersist)'],
      [/ApiRedistributionRecord/, 'client-built financial records (ApiRedistributionRecord)'],
      [/\brecords\s*:/, 'records in the save command'],
      [/original_work_cost\s*:/, 'client-calculated original_work_cost'],
      [/final_work_cost\s*:/, 'client-calculated final_work_cost'],
      [/createdBy\s*:/, 'client-supplied actor (createdBy)'],
    ]) {
      const mm = re.exec(code);
      if (mm) violations.push(`${rel}:${lineOf(code, mm.index)} — ${what}`);
    }
  }
}

// ─── 2. backend: the request DTO has no typed financial records ──────────────
{
  const rel = 'backend/internal/handlers/redistribution.go';
  const code = read(rel);
  if (code != null) {
    const m = /type saveRedistributionReq struct \{([\s\S]*?)\n\}/.exec(code);
    if (!m) {
      violations.push(`${rel} — saveRedistributionReq not found (guard must be kept in sync)`);
    } else {
      for (const [re, what] of [
        [/Records/, 'Records field'],
        [/RedistributionRecord/, 'financial record type'],
        [/original_work_cost|deducted_amount|added_amount|final_work_cost/, 'financial json tag'],
        [/created_by/, 'client-supplied actor'],
      ]) {
        if (re.test(m[1])) {
          violations.push(`${rel}:${lineOf(code, m.index)} — request DTO must not contain ${what}`);
        }
      }
    }
    const use = /req\.Records/.exec(code);
    if (use) violations.push(`${rel}:${lineOf(code, use.index)} — handler must not use req.Records`);
  }
}
{
  const rel = 'backend/internal/services/redistribution.go';
  const code = read(rel);
  if (code != null) {
    const m = /\[\]repository\.RedistributionRecord/.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — service must not accept client financial records`);
    }
  }
}

// ─── 3. SQL: save_redistribution_results is a fail-closed tombstone ──────────
function checkSqlTombstone(rel) {
  const sql = read(rel);
  if (sql == null) return;
  const start = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.save_redistribution_results\s*\(/i.exec(sql);
  if (!start) {
    violations.push(`${rel} — definition of save_redistribution_results not found`);
    return;
  }
  const end = sql.indexOf('END$$;', start.index);
  const def = end >= 0 ? sql.slice(start.index, end + 'END$$;'.length) : sql.slice(start.index);
  const at = lineOf(sql, start.index);

  for (const [re, what] of [
    [/REDISTRIBUTION_RESULT_WRITE_RETIRED/, 'retired marker REDISTRIBUTION_RESULT_WRITE_RETIRED'],
    [/ERRCODE\s*=\s*'0A000'/i, "stable SQLSTATE (ERRCODE = '0A000')"],
    [/SECURITY\s+INVOKER/i, 'SECURITY INVOKER'],
    [/CALLED\s+ON\s+NULL\s+INPUT/i, 'CALLED ON NULL INPUT'],
  ]) {
    if (!re.test(def)) violations.push(`${rel}:${at} — tombstone must contain ${what}`);
  }
  for (const [re, what] of [
    [/INSERT\s+INTO\s+(public\.)?cost_redistribution_results/i, 'INSERT mutation body'],
    [/UPDATE\s+(public\.)?cost_redistribution_results/i, 'UPDATE mutation body'],
    [/DELETE\s+FROM\s+(public\.)?cost_redistribution_results/i, 'DELETE mutation body'],
    [/jsonb_array_elements|jsonb_to_recordset/i, 'p_records parsing'],
    [/ON\s+CONFLICT/i, 'upsert body'],
    [/SECURITY\s+DEFINER/i, 'SECURITY DEFINER'],
    [/RETURNS\s+NULL\s+ON\s+NULL\s+INPUT|^\s*STRICT\s*$/im, 'STRICT'],
  ]) {
    const mm = re.exec(def);
    if (mm) violations.push(`${rel}:${at + lineOf(def, mm.index) - 1} — tombstone must NOT contain ${what}`);
  }
  const revoke = /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+FUNCTION\s+public\.save_redistribution_results\s*\(uuid,\s*uuid,\s*jsonb,\s*jsonb,\s*uuid\)\s+FROM\s+PUBLIC/is;
  if (!revoke.test(sql)) {
    violations.push(`${rel} — missing REVOKE ALL PRIVILEGES … FROM PUBLIC for save_redistribution_results`);
  }
}
checkSqlTombstone('db/yandex/sql/04_functions.sql');
{
  const rel = 'db/yandex/incremental/2026_07_retire_save_redistribution_results.sql';
  checkSqlTombstone(rel);
  const sql = read(rel);
  if (sql != null) {
    if (!/^\s*BEGIN;/m.test(sql) || !/^\s*COMMIT;/m.test(sql)) {
      violations.push(`${rel} — migration must be transactional (BEGIN; … COMMIT;)`);
    }
    if (!/aclexplode/i.test(sql)) {
      violations.push(`${rel} — migration must revoke EXECUTE from discovered non-owner grantees`);
    }
  }
}

// ─── 4. no production caller of the retired RPC ──────────────────────────────
const SCAN_DIRS = ['src', 'backend', 'scripts'];
const ALLOWED = new Set([
  'src/lib/types/database.types.ts',
  'scripts/checks/noClientRedistributionResults.check.mjs',
]);
const EXT = new Set(['.ts', '.tsx', '.go', '.mjs', '.js']);
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
    if (ALLOWED.has(rel) || /_test\.go$/.test(rel)) continue;
    const text = readFileSync(file, 'utf8');
    const i = text.indexOf('save_redistribution_results');
    if (i >= 0) {
      violations.push(`${rel}:${lineOf(text, i)} — production code references the retired RPC save_redistribution_results`);
    }
  }
}

console.log('noClientRedistributionResults.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: the redistribution save path must stay server-authoritative.');
  console.error('    The client sends ONLY rules; results are calculated by backend/internal/calc.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — frontend save command carries only tender/tactic/rules');
console.log('  ok — backend request DTO has no typed financial records');
console.log('  ok — save_redistribution_results is a fail-closed tombstone (baseline + migration)');
console.log('  ok — no production caller of the retired RPC');
console.log('\nnoClientRedistributionResults.check: passed');
