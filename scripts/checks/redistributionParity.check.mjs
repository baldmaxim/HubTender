// Stage 0.1.2.3a Go↔TS parity check — run via tsx:
//   npx tsx scripts/checks/redistributionParity.check.mjs
//
// Runs the FRONTEND preview engine (calculateDistribution.ts) against the SAME
// golden fixtures that drive backend/internal/calc/redistribution_golden_test.go.
// Any numeric drift between the two engines turns this check (or the Go test)
// red. The TS engine is UI preview only — persisted results are calculated by
// backend/internal/calc — but until full removal the preview must not lie.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calculateRedistribution } from '../../src/pages/CostRedistribution/utils/calculateDistribution.ts';

const fixturePath = fileURLToPath(
  new URL('../../backend/internal/calc/testdata/redistribution_cases.json', import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const EPS = 1e-9;
const near = (a, b) => Math.abs(a - b) <= EPS;

const failures = [];

if (!Array.isArray(fixture.cases) || fixture.cases.length < 12) {
  failures.push(`fixture must keep >= 12 cases, got ${fixture.cases?.length}`);
}

const detailCategoriesMap = new Map(Object.entries(fixture.detail_categories));

for (const tc of fixture.cases) {
  const items = tc.boq_items.map((it) => ({
    id: it.id,
    client_position_id: it.client_position_id,
    detail_cost_category_id: it.detail_cost_category_id ?? null,
    boq_item_type: it.boq_item_type,
    total_commercial_work_cost: it.total_commercial_work_cost,
    total_commercial_material_cost: 0,
  }));
  const sources = tc.deductions.map((r) => ({
    level: r.level,
    category_id: r.category_id || undefined,
    detail_cost_category_id: r.detail_cost_category_id || undefined,
    category_name: '',
    percentage: r.percentage,
    ...(r.boq_item_types ? { boq_item_types: r.boq_item_types } : {}),
  }));
  const targets = tc.targets.map((r) => ({
    level: r.level,
    category_id: r.category_id || undefined,
    detail_cost_category_id: r.detail_cost_category_id || undefined,
    category_name: '',
  }));

  const out = calculateRedistribution(items, sources, targets, detailCategoriesMap);

  const exp = tc.expected;
  if (!near(out.totalDeducted, exp.total_deducted)) {
    failures.push(`${tc.name}: totalDeducted = ${out.totalDeducted}, want ${exp.total_deducted}`);
  }
  if (!near(out.totalAdded, exp.total_added)) {
    failures.push(`${tc.name}: totalAdded = ${out.totalAdded}, want ${exp.total_added}`);
  }
  if (out.isBalanced !== exp.is_balanced) {
    failures.push(`${tc.name}: isBalanced = ${out.isBalanced}, want ${exp.is_balanced}`);
  }
  if (out.results.length !== Object.keys(exp.results).length) {
    failures.push(`${tc.name}: results count ${out.results.length}, want ${Object.keys(exp.results).length}`);
    continue;
  }
  for (const row of out.results) {
    const want = exp.results[row.boq_item_id];
    if (!want) {
      failures.push(`${tc.name}: unexpected row ${row.boq_item_id}`);
      continue;
    }
    if (!near(row.original_work_cost, want.original) ||
        !near(row.deducted_amount, want.deducted) ||
        !near(row.added_amount, want.added) ||
        !near(row.final_work_cost, want.final)) {
      failures.push(
        `${tc.name}: row ${row.boq_item_id} = {${row.original_work_cost}, ${row.deducted_amount}, ${row.added_amount}, ${row.final_work_cost}}, ` +
        `want {${want.original}, ${want.deducted}, ${want.added}, ${want.final}}`,
      );
    }
  }
}

console.log('redistributionParity.check:');
if (failures.length > 0) {
  console.error('\n  ✗ Go↔TS redistribution engines diverged on the golden fixtures.\n');
  for (const f of failures) console.error('    - ' + f);
  console.error('');
  process.exit(1);
}
console.log(`  ok — ${fixture.cases.length} golden cases match the TS preview engine (epsilon 1e-9)`);
console.log('\nredistributionParity.check: passed');
