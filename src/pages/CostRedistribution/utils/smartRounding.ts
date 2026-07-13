// UI display only — rounds unit prices to 2 dp for presentation. NOT the money
// source of truth; the authoritative 5-RUB kernel is backend/internal/calc
// (RoundTo5 / CompensateError). See docs/CALCULATION_SOURCE_OF_TRUTH.md.
/**
 * Округление цен за единицу до 2 знаков после запятой
 */

import type { ResultRow } from '../components/Results/ResultsTableColumns';

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function smartRoundResults(results: ResultRow[]): ResultRow[] {
  return results.map((row) => {
    const result = { ...row };

    if (row.total_materials !== 0 && row.quantity > 0) {
      const roundedPrice = roundTo2(row.material_unit_price);
      result.rounded_material_unit_price = roundedPrice;
      result.rounded_total_materials = roundTo2(roundedPrice * row.quantity);
    } else {
      result.rounded_material_unit_price = 0;
      result.rounded_total_materials = 0;
    }

    if (row.total_works_after !== 0 && row.quantity > 0) {
      const roundedPrice = roundTo2(row.work_unit_price_after);
      result.rounded_work_unit_price_after = roundedPrice;
      result.rounded_total_works = roundTo2(roundedPrice * row.quantity);
    } else {
      result.rounded_work_unit_price_after = 0;
      result.rounded_total_works = 0;
    }

    return result;
  });
}
