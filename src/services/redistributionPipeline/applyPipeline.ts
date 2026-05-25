import { smartRoundResults } from '../../pages/CostRedistribution/utils/smartRounding';
import type { ResultRow } from '../../pages/CostRedistribution/components/Results/ResultsTableColumns';

// Расширение ResultRow дополнительными полями: пред-посчитанная доля страхования
// и pre-insurance сумма работ, чтобы потребители (Commerce, оба Excel) могли
// либо взять готовый «с страхованием» (rounded_total_works = total_works_after_with_insurance),
// либо отдельно сумму работ и страхования.
export interface PreparedRow extends ResultRow {
  insurance_share: number;
  total_works_after_with_insurance: number;
  total_works_after_pre_insurance: number;
}

export interface PreparedPipelineResult {
  rows: PreparedRow[];
  totals: {
    totalMaterials: number;
    totalWorks: number;
    total: number;
  };
}

export interface RedistributionPipelineInput {
  // Результат buildResultRows(clientPositions, boqItemsByPosition, resultsMap):
  // per-position суммы материалов и работ после category-redistribution.
  // CR на странице мемоизирует их отдельно от деталей, чтобы не пересчитывать
  // O(positions × boqItems) при каждом изменении position-adjustment.
  categoryLevelRows: ResultRow[];
  // Суммарная (по всем итерациям position-level) дельта работ на позицию.
  positionAdjustmentDeltas?: Map<string, number>;
  // insuranceTotal = computeInsuranceTotal(loadTenderInsurance(...))
  insuranceTotal: number;
}

// Применяет общий pipeline:
//   1. position-adjustment deltas → adjusted total_works_after / unit_price
//   2. smartRoundResults → округление к кратному 5 ₽ с компенсацией ошибки
//   3. пропорциональное разнесение insuranceTotal по rounded_total_works
//
// Поведение и числа должны 1-в-1 совпадать с inline-кодом CostRedistribution.tsx,
// чтобы Commerce/Excel/FI могли стать «единым источником правды»: страница
// «Перераспределение» — эталон.
export function applyRedistributionPipeline(
  input: RedistributionPipelineInput,
): PreparedPipelineResult {
  const { categoryLevelRows, positionAdjustmentDeltas, insuranceTotal } = input;

  const hasDeltas = positionAdjustmentDeltas && positionAdjustmentDeltas.size > 0;
  const adjustedRows = !hasDeltas
    ? categoryLevelRows
    : categoryLevelRows.map((row) => {
        const delta = positionAdjustmentDeltas.get(row.position_id) ?? 0;
        if (delta === 0) return row;
        const adjustedWorksAfter = row.total_works_after + delta;
        const q = row.quantity || 1;
        return {
          ...row,
          total_works_after: adjustedWorksAfter,
          work_unit_price_after: adjustedWorksAfter / q,
          redistribution_amount: row.redistribution_amount + delta,
        };
      });

  const roundedRows = smartRoundResults(adjustedRows);
  const totalWorksBase = roundedRows.reduce(
    (sum, row) => sum + (row.rounded_total_works ?? row.total_works_after),
    0,
  );

  const rows: PreparedRow[] =
    insuranceTotal > 0 && totalWorksBase > 0
      ? roundedRows.map((row) => {
          const worksAfter = row.rounded_total_works ?? row.total_works_after;
          const insuranceShare = insuranceTotal * (worksAfter / totalWorksBase);
          const newWorks = worksAfter + insuranceShare;
          return {
            ...row,
            rounded_total_works: newWorks,
            rounded_work_unit_price_after: newWorks / (row.quantity || 1),
            insurance_share: insuranceShare,
            total_works_after_with_insurance: newWorks,
            total_works_after_pre_insurance: worksAfter,
          };
        })
      : roundedRows.map((row) => {
          const worksAfter = row.rounded_total_works ?? row.total_works_after;
          return {
            ...row,
            insurance_share: 0,
            total_works_after_with_insurance: worksAfter,
            total_works_after_pre_insurance: worksAfter,
          };
        });

  const totals = rows.reduce(
    (acc, row) => {
      acc.totalMaterials += row.rounded_total_materials ?? row.total_materials;
      acc.totalWorks += row.rounded_total_works ?? row.total_works_after;
      return acc;
    },
    { totalMaterials: 0, totalWorks: 0, total: 0 },
  );
  totals.total = totals.totalMaterials + totals.totalWorks;

  return { rows, totals };
}
