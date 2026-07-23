import type { PricingDistribution } from '../../../../services/markupTactic/calculation';
import type { getTenderById, BoqItemWithPosition } from '../../../../lib/api/fi';
import type { DirectCostTotals } from '../../types';
import {
  emptyDirectCostTotals,
  accumulateDirectCost,
  type GrowthExclusionSets,
} from '../../utils/aggregateDirectCosts';
import { createReduciblePredicate } from './reducibleItems';
import type { PositionReducible } from '../types';

type TenderFI = Awaited<ReturnType<typeof getTenderById>>;

/**
 * Снижаемые прямые затраты в разрезе позиций Заказчика.
 *
 * Один проход по уже загруженному массиву boq_items: элементы, не проходящие
 * критерий снижаемости, пропускаются целиком, остальные раскладываются по
 * корзинам тем же `accumulateDirectCost`, что и общий агрегат тендера — так
 * исключения роста субподряда и валютная конвертация считаются одинаково.
 *
 * Элементы без курса валюты здесь просто пропускаются: страница до этого места
 * доходит только когда общий агрегат прошёл fail-closed-проверку, то есть курсы
 * есть у всех строк.
 */
export const buildReduciblePositionTotals = (
  boqItems: BoqItemWithPosition[] | null | undefined,
  tender: TenderFI,
  excluded: GrowthExclusionSets,
  distribution: PricingDistribution | null,
): Map<string, DirectCostTotals> => {
  const isReducible = createReduciblePredicate(distribution);
  const byPosition = new Map<string, DirectCostTotals>();

  boqItems?.forEach(item => {
    const positionId = item.client_position_id;
    if (!positionId) return;
    if (!isReducible(item.boq_item_type, item.material_type)) return;

    let acc = byPosition.get(positionId);
    if (!acc) {
      acc = emptyDirectCostTotals();
      byPosition.set(positionId, acc);
    }
    accumulateDirectCost(acc, item, tender, excluded);
  });

  return byPosition;
};

/**
 * Достроить коммерческую стоимость к каждому набору прямых затрат.
 * `commercialOf` — обычно свёртка через вектор множителей каскада
 * (см. markupMultipliers.ts).
 */
export const toPositionReducibles = (
  totalsByPosition: Map<string, DirectCostTotals>,
  commercialOf: (totals: DirectCostTotals) => number,
): Map<string, PositionReducible> => {
  const out = new Map<string, PositionReducible>();
  for (const [positionId, totals] of totalsByPosition) {
    out.set(positionId, { positionId, totals, commercial: commercialOf(totals) });
  }
  return out;
};
