// Stage 0.1.2.3b Go↔TS parity check — run via tsx:
//   npx tsx scripts/checks/redistributionPipelineParity.check.mjs
//
// Runs the FRONTEND preview pipeline (buildResultRows →
// computeCumulativePositionDeltas → applyRedistributionPipeline, with
// computeInsuranceTotal) over the SAME fixtures that drive
// backend/internal/calc/redistribution_prepared_test.go. Any numeric drift
// turns this check (or the Go test) red.
//
// The preview stays preview-only: after save the server prepared result is the
// source of truth. expect_error cases are skipped here — the TS preview
// SILENTLY DROPS invalid position rules (computeCumulativePositionDeltas),
// while the server blocks them; this divergence is documented and the server
// is authoritative.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildResultRows } from '../../src/pages/CostRedistribution/utils/buildResultRows.ts';
import { computeCumulativePositionDeltas } from '../../src/pages/CostRedistribution/utils/calculatePositionAdjustment.ts';
import {
  applyRedistributionPipeline,
  computeInsuranceTotal,
} from '../../src/services/redistributionPipeline/index.ts';

const fixturePath = fileURLToPath(
  new URL('../../backend/internal/calc/testdata/redistribution_pipeline_cases.json', import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const EPS = 1e-6;
const near = (a, b) => Math.abs(a - b) <= EPS;
const failures = [];

for (const tc of fixture.cases) {
  if (tc.expect_error) continue; // server-only semantics (see header)

  const positions = tc.positions.map((p) => ({
    id: p.id,
    tender_id: 't',
    position_number: p.number,
    section_number: null,
    position_name: 'n-' + p.id,
    unit_code: 'м2',
    volume: p.volume ?? null,
    manual_volume: p.manual_volume ?? null,
    manual_note: null,
    item_no: null,
    work_name: 'w-' + p.id,
    parent_position_id: p.parent_position_id ?? null,
    is_additional: p.is_additional ?? false,
    hierarchy_level: p.hierarchy_level ?? 0,
  }));

  const boqItemsByPosition = new Map();
  for (const it of tc.boq_items) {
    const entry = {
      id: it.id,
      client_position_id: it.position_id,
      total_commercial_work_cost: it.work_cost,
      total_commercial_material_cost: it.material_cost,
    };
    const list = boqItemsByPosition.get(it.position_id);
    if (list) list.push(entry);
    else boqItemsByPosition.set(it.position_id, [entry]);
  }

  const resultsMap = new Map();
  for (const r of tc.category_results) {
    resultsMap.set(r.boq_item_id, {
      boq_item_id: r.boq_item_id,
      original_work_cost: r.original,
      deducted_amount: r.deducted,
      added_amount: r.added,
      final_work_cost: r.final,
    });
  }

  const categoryLevelRows = buildResultRows(positions, boqItemsByPosition, resultsMap);

  const adjustmentBase = categoryLevelRows.map((row) => ({
    position_id: row.position_id,
    total_works_after: row.total_works_after,
  }));
  const { cumulative: deltas } = computeCumulativePositionDeltas(
    adjustmentBase,
    (tc.position_adjustments ?? []).map((r) => ({
      mode: r.mode,
      amount: r.amount,
      sourceIds: r.sourceIds ?? [],
      targetIds: r.targetIds ?? [],
    })),
  );

  const insuranceTotal = computeInsuranceTotal(tc.insurance ?? null);
  const prepared = applyRedistributionPipeline({
    categoryLevelRows,
    positionAdjustmentDeltas: deltas,
    insuranceTotal,
  });

  const rowById = new Map(prepared.rows.map((r) => [r.position_id, r]));

  if (tc.expected.row_order) {
    const order = prepared.rows.map((r) => r.position_id);
    if (JSON.stringify(order) !== JSON.stringify(tc.expected.row_order)) {
      failures.push(`${tc.name}: row order ${order} != ${tc.expected.row_order}`);
    }
  }

  for (const [id, want] of Object.entries(tc.expected.rows ?? {})) {
    const row = rowById.get(id);
    if (!row) {
      failures.push(`${tc.name}: row ${id} missing in TS preview`);
      continue;
    }
    const checks = [
      ['work_after_adjustments', want.work_after_adjustments, row.total_works_after],
      ['work_rounded', want.work_rounded, row.total_works_after_pre_insurance],
      ['insurance', want.insurance, row.insurance_share],
      ['final_work', want.final_work, row.total_works_after_with_insurance],
      ['material_rounded', want.material_rounded, row.rounded_total_materials],
    ];
    for (const [name, w, got] of checks) {
      if (w != null && !near(w, got)) {
        failures.push(`${tc.name}: ${id}.${name} = ${got}, want ${w}`);
      }
    }
    if (want.final_total != null) {
      const gotTotal = (row.rounded_total_materials ?? 0) + row.total_works_after_with_insurance;
      if (!near(want.final_total, gotTotal)) {
        failures.push(`${tc.name}: ${id}.final_total = ${gotTotal}, want ${want.final_total}`);
      }
    }
  }

  const s = tc.expected.summary ?? {};
  if (s.final_work_total != null && !near(prepared.totals.totalWorks, s.final_work_total)) {
    failures.push(`${tc.name}: totals.totalWorks = ${prepared.totals.totalWorks}, want ${s.final_work_total}`);
  }
  if (s.total_material_cost != null && !near(prepared.totals.totalMaterials, s.total_material_cost)) {
    failures.push(`${tc.name}: totals.totalMaterials = ${prepared.totals.totalMaterials}, want ${s.total_material_cost}`);
  }
  if (s.final_total != null && !near(prepared.totals.total, s.final_total)) {
    failures.push(`${tc.name}: totals.total = ${prepared.totals.total}, want ${s.final_total}`);
  }
  if (s.insurance_total != null) {
    if (!near(insuranceTotal, s.insurance_total)) {
      failures.push(`${tc.name}: insuranceTotal = ${insuranceTotal}, want ${s.insurance_total}`);
    }
  }
}

console.log('redistributionPipelineParity.check:');
if (failures.length > 0) {
  console.error('\n  ✗ Go↔TS prepared pipeline diverged on the golden fixtures.\n');
  for (const f of failures) console.error('    - ' + f);
  console.error('');
  process.exit(1);
}
console.log(`  ok — ${fixture.cases.length} pipeline cases match the TS preview (epsilon 1e-6; expect_error cases are server-only)`);
console.log('\nredistributionPipelineParity.check: passed');
