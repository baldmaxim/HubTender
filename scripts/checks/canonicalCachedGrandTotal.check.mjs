// Stage 0.1.2.4a source guard — run via tsx:
//   npx tsx scripts/checks/canonicalCachedGrandTotal.check.mjs
//
// The tenders.cached_grand_total formula exists ONLY in backend/internal/calc
// (CalculateCachedTenderGrandTotal + CalculateInsuranceTotal). This guard fails
// if production code re-introduces:
//   1. a Go caller of public.recalculate_tender_grand_total;
//   2. a manual SQL/Go formula (commercial sum + insurance + ROUND) in the
//      repository writer;
//   3. a duplicated insurance formula in tender_recalc.go;
//   4. a non-tombstone SQL recalc function or grand-total triggers in the
//      baseline;
//   5. a second production UPDATE of cached_grand_total outside the helper;
//   6. app.skip_grand_total (the setting is obsolete — no consumer remains);
//   7. legacy calc.CalculateGrandTotal wired into the cached-total writer;
//   8. a frontend recalculation of cached_grand_total for authoritative use.
//
// Stage 0.1.2.4a.1 (exact decimal rounding contract) additions — the
// authoritative boundary (calc/cached_grand_total.go, calc/money_decimal.go,
// repository/tender_recalc.go) must stay decimal-exact:
//   9.  no binary math.Round / strconv.ParseFloat / epsilon (1e-…) inside the
//       boundary files (math.Round stays legal ONLY in the prepared-pipeline
//       preview round2 — a different, non-authoritative path);
//   10. tender_recalc.go reads BOTH commercial aggregates as numeric::text
//       (never through float64 — the file must not mention float64 at all);
//   11. tender_recalc.go persists the kernel's RoundedTotalDecimal string
//       (no float bind, no re-rounding).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const violations = [];
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

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

function* walk(dir, exts) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'archive') continue;
      yield* walk(abs, exts);
    } else if (exts.has(name.slice(name.lastIndexOf('.')))) {
      yield abs;
    }
  }
}

// ─── 1/5/6. production Go scan ────────────────────────────────────────────────
{
  const goDir = join(ROOT, 'backend/internal');
  const updateWriters = [];
  for (const file of walk(goDir, new Set(['.go']))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (/_test\.go$/.test(rel)) continue;
    const code = stripComments(readFileSync(file, 'utf8'));

    const sqlCall = /recalculate_tender_grand_total/.exec(code);
    if (sqlCall && !rel.endsWith('tender_recalc.go')) {
      violations.push(`${rel}:${lineOf(code, sqlCall.index)} — production Go calls the retired SQL function`);
    }
    const skip = /skip_grand_total/.exec(code);
    if (skip) {
      violations.push(`${rel}:${lineOf(code, skip.index)} — obsolete app.skip_grand_total usage`);
    }
    const upd = /cached_grand_total\s*=/.exec(code);
    if (upd) updateWriters.push(`${rel}:${lineOf(code, upd.index)}`);
  }
  // 5. exactly ONE production UPDATE writer — the transaction-aware helper.
  if (updateWriters.length !== 1 || !updateWriters[0].includes('tender_recalc.go')) {
    violations.push(`cached_grand_total writers must be exactly [tender_recalc.go], got: ${updateWriters.join(', ') || '(none)'}`);
  }
}

// ─── 2/3/7. the writer itself: no formula, no insurance duplicate ─────────────
{
  const rel = 'backend/internal/repository/tender_recalc.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    for (const [re, what] of [
      [/ROUND\s*\(/i, 'SQL ROUND (rounding must live in calc)'],
      [/apt_price_m2\s*\*\s*apt_area/, 'duplicated insurance formula'],
      [/judicial_pct\s*\/\s*100/, 'duplicated insurance percentage math'],
      [/material_cost\s*\+\s*.*work_cost/, 'manual commercial-sum formula in SQL'],
      [/CalculateGrandTotal\s*\(/, 'legacy calc.CalculateGrandTotal wired into the cached-total writer'],
    ]) {
      const m = re.exec(code);
      if (m) violations.push(`${rel}:${lineOf(code, m.index)} — ${what}`);
    }
    for (const needle of ['CalculateCachedTenderGrandTotal', 'CalculateInsuranceTotalDecimal']) {
      if (!code.includes(needle)) {
        violations.push(`${rel} — must delegate to calc.${needle}`);
      }
    }
    // 10. exact aggregate reads: both SUMs leave PostgreSQL as numeric::text.
    for (const col of ['total_commercial_material_cost', 'total_commercial_work_cost']) {
      const re = new RegExp(`SUM\\(COALESCE\\(${col}[^)]*\\)\\)[\\s\\S]{0,20}?::text`);
      if (!re.test(code)) {
        violations.push(`${rel} — ${col} aggregate must be read as numeric::text (no float64 scan)`);
      }
    }
    const flt = /float64/.exec(code);
    if (flt) {
      violations.push(`${rel}:${lineOf(code, flt.index)} — float64 on the authoritative decimal boundary`);
    }
    // 11. the persisted value is the kernel's canonical decimal string.
    if (!code.includes('RoundedTotalDecimal')) {
      violations.push(`${rel} — must bind result.RoundedTotalDecimal (string) into the UPDATE`);
    }
  }
}

// ─── 9. decimal boundary files: no binary rounding, no epsilon, no ParseFloat ─
{
  const boundaryFiles = [
    'backend/internal/calc/cached_grand_total.go',
    'backend/internal/calc/money_decimal.go',
    'backend/internal/repository/tender_recalc.go',
  ];
  for (const rel of boundaryFiles) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    for (const [re, what] of [
      [/math\.Round\s*\(/, 'binary math.Round as money policy (decimal boundary must use RoundMoney2Decimal)'],
      [/\b\d(\.\d+)?e-\d/i, 'epsilon hack on the authoritative rounding path'],
      [/strconv\.ParseFloat\s*\(/, 'float64 parse on the decimal boundary'],
    ]) {
      const m = re.exec(code);
      if (m) violations.push(`${rel}:${lineOf(code, m.index)} — ${what}`);
    }
  }
}

// ─── 4. baseline SQL: tombstone + no grand-total triggers ─────────────────────
{
  const rel = 'db/yandex/sql/04_functions.sql';
  const sql = read(rel);
  if (sql != null) {
    const start = /CREATE OR REPLACE FUNCTION public\.recalculate_tender_grand_total/.exec(sql);
    if (!start) {
      violations.push(`${rel} — recalc tombstone definition missing`);
    } else {
      const end = sql.indexOf('$function$;', start.index);
      const def = sql.slice(start.index, end);
      if (!def.includes('GRAND_TOTAL_SQL_RETIRED') || !/SECURITY\s+INVOKER/i.test(def) ||
          !/CALLED\s+ON\s+NULL\s+INPUT/i.test(def)) {
        violations.push(`${rel}:${lineOf(sql, start.index)} — recalc function is not a proper tombstone`);
      }
      if (/UPDATE\s+(public\.)?tenders|boq_items|tender_insurance/i.test(def)) {
        violations.push(`${rel}:${lineOf(sql, start.index)} — tombstone contains financial reads/writes`);
      }
    }
    for (const fn of ['trg_boq_items_update_grand_total', 'trg_insurance_update_grand_total',
      'trg_markup_pct_update_grand_total', 'trg_subcontract_excl_update_grand_total']) {
      if (new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`).test(sql)) {
        violations.push(`${rel} — mutation-capable trigger function ${fn} back in baseline`);
      }
    }
  }
  const trg = read('db/yandex/sql/05_triggers.sql');
  if (trg != null) {
    const m = /CREATE TRIGGER\s+trg_\w*grand_total/.exec(trg);
    if (m) {
      violations.push(`db/yandex/sql/05_triggers.sql:${lineOf(trg, m.index)} — grand-total trigger back in baseline`);
    }
  }
}

// ─── 6b. incremental migration structure ──────────────────────────────────────
{
  const rel = 'db/yandex/incremental/2026_07_retire_sql_grand_total_recalc.sql';
  const sql = read(rel);
  if (sql != null) {
    for (const needle of ['DROP TRIGGER IF EXISTS trg_boq_items_grand_total',
      'DROP FUNCTION IF EXISTS public.trg_boq_items_update_grand_total',
      'GRAND_TOTAL_SQL_RETIRED', 'aclexplode', 'FROM PUBLIC']) {
      if (!sql.includes(needle)) {
        violations.push(`${rel} — missing "${needle}"`);
      }
    }
    // the old formula body must not return inside the migration.
    const strip = stripComments(sql);
    if (/UPDATE\s+public\.tenders\s+SET\s+cached_grand_total\s*=\s*ROUND/i.test(strip)) {
      violations.push(`${rel} — old formula body present in the migration`);
    }
  }
}

// ─── 8. frontend must not recompute cached_grand_total ────────────────────────
{
  const srcDir = join(ROOT, 'src');
  for (const file of walk(srcDir, new Set(['.ts', '.tsx']))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const code = stripComments(readFileSync(file, 'utf8'));
    const m = /cached_grand_total\s*[=:]\s*[^,;\n]*(\+|total_commercial|insurance)/.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — frontend recomputes cached_grand_total`);
    }
  }
}

console.log('canonicalCachedGrandTotal.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: the cached_grand_total formula must exist only in backend/internal/calc.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — no SQL-function callers, no skip_grand_total, single UPDATE writer (tender_recalc.go)');
console.log('  ok — writer delegates to calc; no ROUND / insurance / commercial formula duplicates');
console.log('  ok — decimal boundary: ::text aggregates, string persistence, no math.Round/epsilon/float64');
console.log('  ok — baseline is tombstone-only, no grand-total triggers; migration structured');
console.log('  ok — frontend does not recompute cached_grand_total');
console.log('\ncanonicalCachedGrandTotal.check: passed');
