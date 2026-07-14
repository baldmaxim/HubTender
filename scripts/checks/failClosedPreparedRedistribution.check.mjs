// Stage 0.1.2.3b.1 source guard — run via tsx:
//   npx tsx scripts/checks/failClosedPreparedRedistribution.check.mjs
//
// Pins the fail-closed prepared-redistribution behavior in SOURCE form (the
// behavior itself is proven by unit/focused tests — this guard catches a
// regression re-introducing the fail-open branches):
//
//   1. no pass-through of current commercial values for a missing category
//      result (exact-set mismatch is typed);
//   2. no parent-only drop of cost-bearing additional positions;
//   3. non-zero insurance with a zero eligible base is a typed error;
//   4. Commerce consumes statuses through the SINGLE consumption policy and
//      gates its export (REDISTRIBUTION_RECALCULATION_REQUIRED);
//   5. requires_recalculation is never collapsed into not_configured.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

// ─── 1-3. Go prepared pipeline ────────────────────────────────────────────────
{
  const rel = 'backend/internal/calc/redistribution_prepared.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    // 1. pass-through signature must not return.
    const pt = /worksAfter\s*\+=\s*it\.TotalCommercialWorkCost/.exec(code);
    if (pt) {
      violations.push(`${rel}:${lineOf(code, pt.index)} — pass-through of current commercial work cost for a missing category result`);
    }
    for (const [needle, what] of [
      ['RedistributionSnapshotSetMismatchError{', 'typed exact-set mismatch (RedistributionSnapshotSetMismatchError)'],
      ['AdditionalPositionParentMissingReason', 'cost-bearing additional-position guard (ADDITIONAL_POSITION_PARENT_MISSING)'],
      ['InsuranceZeroBaseReason', 'zero-base insurance guard (NON_ZERO_INSURANCE_WITH_ZERO_BASE)'],
      ['ExpectedRedistributionBoqItems', 'the shared expected-set helper'],
    ]) {
      if (!code.includes(needle)) {
        violations.push(`${rel} — missing ${what}`);
      }
    }
  }
}

// ─── 4/5/7. Commerce consumes via the single policy, export gated ─────────────
{
  const rel = 'src/pages/Commerce/hooks/useCommerceData.ts';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    if (!code.includes('resolveRedistributionConsumptionState')) {
      violations.push(`${rel} — Commerce must resolve statuses through resolveRedistributionConsumptionState`);
    }
    if (!code.includes('state.finalValuesAvailable')) {
      violations.push(`${rel} — prepared consumption must be gated on state.finalValuesAvailable (no live fallback for requires_recalculation)`);
    }
    // §17.7 — no generic status !== 'calculated' branch in the consumer.
    const generic = /status\s*!==?\s*['"]calculated['"]/.exec(code);
    if (generic) {
      violations.push(`${rel}:${lineOf(code, generic.index)} — generic status!==calculated branch; use the consumption policy (not_configured ≠ requires_recalculation)`);
    }
  }
}
{
  const rel = 'src/pages/Commerce/Commerce.tsx';
  const raw = read(rel);
  if (raw != null && !raw.includes('REDISTRIBUTION_RECALCULATION_REQUIRED')) {
    violations.push(`${rel} — Commerce export must be blocked for requires_recalculation (REDISTRIBUTION_RECALCULATION_REQUIRED)`);
  }
}

// ─── 5. the policy itself keeps the states distinct ──────────────────────────
{
  const rel = 'src/lib/redistribution/consumptionState.ts';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    if (!/case\s+'requires_recalculation':/.test(code) ||
        !code.includes("'REDISTRIBUTION_RECALCULATION_REQUIRED'")) {
      violations.push(`${rel} — requires_recalculation must be a distinct fail-closed branch`);
    }
    if (!/case\s+'not_configured':/.test(code)) {
      violations.push(`${rel} — not_configured must be a distinct branch`);
    }
  }
}

// ─── backend: stable reason codes exist ───────────────────────────────────────
{
  const rel = 'backend/internal/repository/redistribution.go';
  const raw = read(rel);
  if (raw != null) {
    for (const code of ['LEGACY_SNAPSHOT', 'SNAPSHOT_SET_MISMATCH', 'PREPARED_INPUT_CHANGED',
      'INSURANCE_ALLOCATION_INVALID', 'PREPARED_CALCULATION_FAILED']) {
      if (!raw.includes(`"${code}"`)) {
        violations.push(`${rel} — missing stable reason code ${code}`);
      }
    }
  }
}

console.log('failClosedPreparedRedistribution.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: a broken/incomplete/stale snapshot must never become a plausible final result.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — no pass-through; exact-set, additional-position and zero-base insurance guards in place');
console.log('  ok — Commerce consumes via the single policy; exports gated; states distinct');
console.log('  ok — stable requires_recalculation reason codes present');
console.log('\nfailClosedPreparedRedistribution.check: passed');
