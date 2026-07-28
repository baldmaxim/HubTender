import { computeIndicators } from '../../utils/computeIndicators';
import { emptyDirectCostTotals } from '../../utils/aggregateDirectCosts';
import type { DirectCostTotals, MarkupCoefficients } from '../../types';

/**
 * Поля DirectCostTotals, которые реально участвуют в каскаде.
 *
 * totalCommercialMaterial / totalCommercialWork сюда НЕ входят: computeIndicators
 * использует их только для кросс-чек-логов и в grandTotal не заводит.
 */
export const CASCADE_FIELDS = [
  'subcontractWorks',
  'subcontractMaterials',
  'subcontractWorksForGrowth',
  'subcontractMaterialsForGrowth',
  'works',
  'materials',
  'materialsComp',
  'worksComp',
  // Разбивки осн/вспом — множитель каскада у них 0 (computeIndicators их не
  // читает), поэтому в S/commercialOf они не вносят вклад, но масштабируются
  // снижением параллельно родительским корзинам → партиция остаётся согласованной
  // (materials = materialsBasic + materialsAux и т.д.) в reducedTotals.
  'materialsBasic',
  'materialsAux',
  'subcontractMaterialsBasic',
  'subcontractMaterialsAux',
  'subcontractMaterialsForGrowthBasic',
  'subcontractMaterialsForGrowthAux',
] as const;

export type CascadeField = (typeof CASCADE_FIELDS)[number];

export type MarkupMultipliers = Record<CascadeField, number>;

/**
 * Эффективный множитель «1 рубль прямых затрат корзины → рублей ИТОГО».
 *
 * Каскад computeIndicators линеен и однороден по прямым затратам (все шаги —
 * умножение на процент и сложение, свободного члена нет), поэтому
 *   grandTotal(totals) = Σ K[field] · totals[field] + вклад страхования.
 * Считаем K прогоном каскада на единичных векторах при insuranceCost = 0 —
 * восемь вызовов на тендер вместо вызова на каждую позицию.
 *
 * Обратный пересчёт «сняли D рублей коммерческой стоимости → сколько это в
 * прямых затратах» получается делением на этот же K, поэтому формулы наценок
 * (1,6 / рост / ООЗ / прибыль / НДС) остаются в одном месте — в computeIndicators.
 */
export const computeMarkupMultipliers = (coeffs: MarkupCoefficients): MarkupMultipliers => {
  const multipliers = {} as MarkupMultipliers;
  for (const field of CASCADE_FIELDS) {
    const unit = emptyDirectCostTotals();
    unit[field] = 1;
    multipliers[field] = computeIndicators(unit, coeffs, 0, { quiet: true }).grandTotal;
  }
  return multipliers;
};

/** Коммерческая стоимость набора прямых затрат (без страхования). */
export const commercialOf = (
  totals: DirectCostTotals,
  multipliers: MarkupMultipliers,
): number => {
  let sum = 0;
  for (const field of CASCADE_FIELDS) {
    sum += multipliers[field] * totals[field];
  }
  return sum;
};

/** Покомпонентное `a + k · b` по полям каскада (остальные поля берутся из `a`). */
export const addScaledTotals = (
  a: DirectCostTotals,
  b: DirectCostTotals,
  k: number,
): DirectCostTotals => {
  const out: DirectCostTotals = { ...a };
  for (const field of CASCADE_FIELDS) {
    out[field] = a[field] + k * b[field];
  }
  return out;
};

/** Сумма прямых затрат по подмножеству позиций. */
export const sumTotals = (parts: Iterable<DirectCostTotals>): DirectCostTotals => {
  const acc = emptyDirectCostTotals();
  for (const part of parts) {
    for (const field of CASCADE_FIELDS) {
      acc[field] += part[field];
    }
  }
  return acc;
};
