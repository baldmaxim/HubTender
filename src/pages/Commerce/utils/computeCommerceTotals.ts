/**
 * Подсчёт сводных итогов КП по позициям.
 * Используется и таблицей (Table.Summary), и закреплённой полосой итогов (CommerceTotalsBar).
 */
import type { PositionWithCommercialCost } from '../types';

export interface CommerceTotals {
  totalBase: number;
  totalMaterials: number;
  totalWorks: number;
  totalWorksWithIns: number;
  totalCommercial: number;
  totalCommercialWithIns: number;
  materialPercent: string;
  workPercent: string;
  totalMarkupCoefficient: number;
  baseTotalMatches: boolean;
}

export function computeCommerceTotals(
  positions: PositionWithCommercialCost[],
  insuranceTotal: number,
  referenceTotal: number,
): CommerceTotals {
  let totalBase = 0;
  let totalMaterials = 0;
  let totalWorks = 0;
  let totalCommercial = 0;

  for (const position of positions) {
    totalBase += position.base_total || 0;
    totalMaterials += position.material_cost_total || 0;
    totalWorks += position.work_cost_total || 0;
    totalCommercial += position.commercial_total || 0;
  }

  const totalWorksWithIns = totalWorks + insuranceTotal;
  const totalCommercialWithIns = totalCommercial + insuranceTotal;

  return {
    totalBase,
    totalMaterials,
    totalWorks,
    totalWorksWithIns,
    totalCommercial,
    totalCommercialWithIns,
    materialPercent:
      totalCommercialWithIns > 0 ? ((totalMaterials / totalCommercialWithIns) * 100).toFixed(1) : '0.0',
    workPercent:
      totalCommercialWithIns > 0 ? ((totalWorksWithIns / totalCommercialWithIns) * 100).toFixed(1) : '0.0',
    totalMarkupCoefficient: totalBase > 0 ? totalCommercialWithIns / totalBase : 1,
    baseTotalMatches: Math.abs(totalBase - referenceTotal) < 0.01,
  };
}
