// Presentation-only mapping: copies SERVER-calculated prepared redistribution
// (backend/internal/calc.BuildPreparedRedistribution) into the display row
// shape used by the results grid and the Excel export. NO financial math here —
// every money value is taken from the server response; the only local
// operations are field copies and display composition of already-served
// numbers (unit-price columns for the "before" display).
import type {
  PreparedServerRedistribution,
  PreparedServerRow,
} from '../../../lib/api/redistributions';
import type { PreparedRow, PreparedPipelineResult } from '../../../services/redistributionPipeline';

function toDisplayRow(r: PreparedServerRow): PreparedRow {
  const q = r.quantity || 1;
  return {
    key: r.position_id,
    position_id: r.position_id,
    position_number: r.position_number,
    section_number: r.section_number,
    position_name: r.position_name,
    item_no: r.item_no,
    work_name: r.work_name,
    client_volume: r.client_volume,
    manual_volume: r.manual_volume,
    unit_code: r.unit_code,
    quantity: r.quantity,
    material_unit_price: r.rounded_material_unit_price,
    work_unit_price_before: r.work_cost_before / q,
    work_unit_price_after: r.work_cost_after_adjustments / q,
    total_materials: r.material_cost,
    total_works_before: r.work_cost_before,
    total_works_after: r.work_cost_after_adjustments,
    redistribution_amount:
      r.category_added - r.category_deducted + (r.position_added - r.position_deducted),
    manual_note: r.manual_note,
    isLeaf: r.is_leaf,
    is_additional: r.is_additional,

    rounded_material_unit_price: r.rounded_material_unit_price,
    rounded_total_materials: r.rounded_material_cost,
    rounded_work_unit_price_after: r.final_work_unit_price,
    rounded_total_works: r.final_work_cost,

    insurance_share: r.insurance_amount,
    total_works_after_with_insurance: r.final_work_cost,
    total_works_after_pre_insurance: r.work_cost_rounded,
  };
}

// mapServerPrepared converts the server prepared projection into the display
// pipeline result shape (rows + totals). Totals come from the SERVER summary.
export function mapServerPrepared(
  prepared: PreparedServerRedistribution,
): PreparedPipelineResult {
  return {
    rows: prepared.rows.map(toDisplayRow),
    totals: {
      totalMaterials: prepared.summary.total_material_cost,
      totalWorks: prepared.summary.final_work_total,
      total: prepared.summary.final_total,
    },
  };
}
