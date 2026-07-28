// UI display / Excel-export only — считает вход для каскада ФП в режиме
// «Обнуление». Персистятся ТОЛЬКО id обнулённых позиций; дельты пересчитываются
// на каждой загрузке. См. docs/CALCULATION_SOURCE_OF_TRUTH.md.
import type { DirectCostTotals } from '../../types';
import { CASCADE_FIELDS } from './markupMultipliers';

// Поля DirectCostTotals, участвующие в вычете (все, кроме кросс-чек-сумм).
const SUBTRACT_FIELDS = [
  ...CASCADE_FIELDS,
  'totalCommercialMaterial',
  'totalCommercialWork',
] as const;

export interface ZeroingApplication {
  /** Прямые затраты тендера после обнуления выбранных позиций. */
  reducedTotals: DirectCostTotals;
  /** Сколько позиций реально обнулено (есть в fullByPosition). */
  zeroedCount: number;
}

/**
 * Полностью убрать выбранные позиции из агрегата тендера: вычесть их полный
 * `DirectCostTotals` (работы + материалы, все типы) из `baseTotals`.
 *
 * Сумма `fullByPosition` по всем позициям = `baseTotals` (тот же
 * `accumulateDirectCost`), поэтому после вычета остаётся агрегат необнулённых
 * позиций. `computeIndicators(reducedTotals)` даёт новые базу и коммерцию, а
 * «Итого материалы» падает на базу обнулённых основных материалов.
 */
export const applyZeroing = (
  baseTotals: DirectCostTotals,
  zeroedPositionIds: Iterable<string>,
  fullByPosition: Map<string, DirectCostTotals>,
): ZeroingApplication => {
  const reduced: DirectCostTotals = { ...baseTotals };
  let zeroedCount = 0;

  for (const id of zeroedPositionIds) {
    const full = fullByPosition.get(id);
    if (!full) continue;
    zeroedCount += 1;
    for (const field of SUBTRACT_FIELDS) {
      reduced[field] -= full[field];
    }
  }

  return { reducedTotals: reduced, zeroedCount };
};
