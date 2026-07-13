// Stage 0.1.2.2a source guard — run via tsx:
//   npx tsx scripts/checks/noDerivedCopy.check.mjs
//
// BOQ copy / version transfer must carry ONLY source inputs. The calculated money
// columns (total_amount, commercial_markup, total_commercial_material_cost,
// total_commercial_work_cost) must never be selected from the source row and
// written into the target as authoritative: they are recomputed server-side from
// the TARGET tender's FX rates and configuration.
//
// This check fails if the production copy/transfer code ever starts copying them
// again, grows its own quantity*unit_rate formula, or re-introduces an FX
// fallback of 1.
//
// Scope: production Go of the copy/transfer paths only. Tests, fixtures and docs
// are NOT scanned.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Production copy/transfer sources (no _test.go).
const FILES = [
  'backend/internal/repository/boq_copy.go',
  'backend/internal/repository/tender_transfer_boq.go',
];

const DERIVED = [
  'total_amount',
  'commercial_markup',
  'total_commercial_material_cost',
  'total_commercial_work_cost',
];

/** Strip // line comments and /* block *​/ comments, preserving offsets. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const violations = [];
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

for (const rel of FILES) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push(`${rel} — file missing (guard must be kept in sync)`);
    continue;
  }
  const code = stripComments(readFileSync(abs, 'utf8'));

  // 1. A derived column must never be read off the SOURCE row.
  //    e.g. `old_boq.total_amount`, `s.CommercialMarkup`, `src.total_amount`
  for (const col of DERIVED) {
    const re = new RegExp(`(old_boq|src|gen|source|s)\\s*\\.\\s*${col}\\b`, 'i');
    const m = re.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — copies derived column from source: ${m[0]}`);
    }
  }

  // 2. A derived column must never appear in an INSERT column list.
  const insertRe = /INSERT\s+INTO\s+public\.boq_items\s*\(([\s\S]*?)\)/gi;
  let ins;
  while ((ins = insertRe.exec(code)) !== null) {
    for (const col of DERIVED) {
      if (new RegExp(`\\b${col}\\b`).test(ins[1])) {
        violations.push(
          `${rel}:${lineOf(code, ins.index)} — derived column "${col}" in an INSERT column list`,
        );
      }
    }
  }

  // 3. No local money formula.
  const formula = /quantity\s*\*\s*unit_?rate|unitRate\s*\*\s*(cRate|rate)/i.exec(code);
  if (formula) {
    violations.push(
      `${rel}:${lineOf(code, formula.index)} — local money formula (use calc.CalculateBoqItemTotalAmount): ${formula[0]}`,
    );
  }

  // 4. No FX fallback to 1 (orOne on a currency rate).
  const fx = /orOne\s*\(\s*(usd|eur|cny)/i.exec(code);
  if (fx) {
    violations.push(`${rel}:${lineOf(code, fx.index)} — FX fallback to 1.0: ${fx[0]}`);
  }
}

console.log('noDerivedCopy.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: copy/transfer must not carry calculated money from the source.');
  console.error('    total_amount and commercial_* are recomputed server-side for the TARGET tender.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — copy/transfer select only source inputs (no derived columns)');
console.log('  ok — no derived column in any boq_items INSERT column list');
console.log('  ok — no local quantity*unit_rate formula, no FX fallback = 1');
console.log('\nnoDerivedCopy.check: passed');
