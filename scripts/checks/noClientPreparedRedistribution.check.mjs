// Stage 0.1.2.3b source guard — run via tsx:
//   npx tsx scripts/checks/noClientPreparedRedistribution.check.mjs
//
// The prepared redistribution pipeline (position adjustments, insurance
// allocation, rounding, final rows, summary) is calculated ONLY by
// backend/internal/calc. The client preview calculators are allowed ONLY in
// the CostRedistribution editor, the pipeline modules themselves, and
// tests/checks. Production consumers (Commerce, FinancialIndicators, Excel
// exports) must consume the server prepared response and never recompute money.
//
// Presentation formatting (currency formatting, sorting, display DTO mapping
// of already-served numbers) is deliberately NOT restricted.

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
  return stripComments(readFileSync(abs, 'utf8'));
}

// Financial preview calculators (functions, not types).
const PREVIEW_FNS = [
  'applyRedistributionPipeline',
  'computeInsuranceTotal',
  'computeCumulativePositionDeltas',
  'calculatePositionAdjustment',
  'buildResultRows',
  'smartRoundResults',
];
// Modules whose non-type import into consumers is forbidden.
const PREVIEW_MODULES = [
  'redistributionPipeline',
  'buildResultRows',
  'calculatePositionAdjustment',
  'smartRounding',
  'calculateDistribution',
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      yield* walk(abs);
    } else if (/\.(ts|tsx)$/.test(name)) {
      yield abs;
    }
  }
}

// ─── 1-3. Commerce / FI / Excel exports must not compute redistribution money ─
const CONSUMER_DIRS = ['src/pages/Commerce', 'src/pages/FinancialIndicators', 'src/pages/Analytics'];
const EXPORT_FILES = ['src/pages/CostRedistribution/utils/exportToExcel.ts'];

function checkConsumer(rel, code) {
  // non-type imports of the preview modules
  const importRe = /import\s+(?!type\b)[^;]*?from\s+'([^']+)'/g;
  let m;
  while ((m = importRe.exec(code)) !== null) {
    for (const mod of PREVIEW_MODULES) {
      if (m[1].includes(mod)) {
        violations.push(`${rel}:${lineOf(code, m.index)} — imports preview calculator module "${mod}" (server prepared response is the only money source)`);
      }
    }
  }
  // direct calls
  for (const fn of PREVIEW_FNS) {
    const call = new RegExp(`\\b${fn}\\s*\\(`).exec(code);
    if (call) {
      violations.push(`${rel}:${lineOf(code, call.index)} — calls preview calculator ${fn}()`);
    }
  }
}

for (const dir of CONSUMER_DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const code = stripComments(readFileSync(file, 'utf8'));
    checkConsumer(rel, code);
  }
}
for (const rel of EXPORT_FILES) {
  const code = read(rel);
  if (code != null) checkConsumer(rel, code);
}

// ─── 4. the save request carries no prepared/financial values ────────────────
{
  const rel = 'src/lib/api/redistributions.ts';
  const code = read(rel);
  if (code != null) {
    const m = /saveRedistributionResults[\s\S]*?body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/.exec(code);
    if (!m) {
      violations.push(`${rel} — save body construction not found (guard must be kept in sync)`);
    } else {
      for (const f of ['prepared', 'prepared_rows', 'position_results', 'insurance_total',
        'insurance_allocation', 'rounding_adjustments', 'summary', 'records']) {
        if (new RegExp(`\\b${f}\\b`).test(m[1])) {
          violations.push(`${rel}:${lineOf(code, m.index)} — save request body must not contain "${f}"`);
        }
      }
    }
  }
}

// ─── 5. the backend request DTO has no client-calculated prepared fields ─────
{
  const rel = 'backend/internal/handlers/redistribution.go';
  const code = read(rel);
  if (code != null) {
    const m = /type saveRedistributionReq struct \{([\s\S]*?)\n\}/.exec(code);
    if (!m) {
      violations.push(`${rel} — saveRedistributionReq not found`);
    } else if (/Prepared|PositionResults|InsuranceTotal|RoundingAdjustments|Summary/.test(m[1])) {
      violations.push(`${rel}:${lineOf(code, m.index)} — request DTO must not contain client-calculated prepared fields`);
    }
  }
}

// ─── 7. no preview fallback on a non-calculated status in consumers ──────────
// Commerce resets to live-calc when status !== 'calculated'; a reappearing
// preview-calculator import (rules 1-3) is exactly how such a fallback would
// come back, so it is covered above. Additionally, the CR export must gate on
// the server prepared result.
{
  const rel = 'src/pages/CostRedistribution/CostRedistribution.tsx';
  const code = read(rel);
  if (code != null && !/REDISTRIBUTION_EXPORT_NOT_READY/.test(code)) {
    violations.push(`${rel} — the Excel export must be blocked without a server prepared result (REDISTRIBUTION_EXPORT_NOT_READY)`);
  }
}

console.log('noClientPreparedRedistribution.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: prepared redistribution money must come from backend/internal/calc only.');
  console.error('    Preview calculators are allowed only in the CostRedistribution editor and the pipeline modules.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — Commerce/FI/Analytics/Excel do not import or call preview calculators');
console.log('  ok — save request and backend DTO carry no client-calculated prepared values');
console.log('  ok — CR export is gated on the server prepared result');
console.log('\nnoClientPreparedRedistribution.check: passed');
