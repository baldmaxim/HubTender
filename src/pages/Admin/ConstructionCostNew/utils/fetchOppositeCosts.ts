import { listBoqItemsFullByTender } from '../../../../lib/api/positions';
import {
  loadLiveCommercialCalculationContext,
  resetLiveCommercialCalculationCache,
} from '../../../../utils/boq/liveCommercialCalculation';
import { formatFXUnavailable } from '../../../../utils/boq/currencyGuard';
import { aggregateBoqCosts } from './aggregateBoqCosts';
import type { BoqItemForCost, CostSums } from '../types';

/**
 * Получает суммы затрат противоположного типа (по detail_cost_category_id).
 *
 * Использует тот же конвейер, что и страница (loadLiveCommercialCalculationContext
 * + aggregateBoqCosts): live-расчёт по действующей markup-тактике, FX-пересчёт и
 * распределение по колонкам «материалы/работы». Собственная упрощённая агрегация
 * здесь недопустима — она расходилась с экраном.
 */
export async function fetchOppositeCosts(
  tenderId: string,
  currentCostType: 'base' | 'commercial'
): Promise<Map<string, CostSums>> {
  const oppositeType = currentCostType === 'base' ? 'commercial' : 'base';

  const calculationContext = await loadLiveCommercialCalculationContext(tenderId);
  resetLiveCommercialCalculationCache();

  const boqItems = (await listBoqItemsFullByTender(tenderId)) as unknown as BoqItemForCost[];

  const result = aggregateBoqCosts(boqItems, oppositeType, calculationContext);

  // Fail-closed: нет курса валюты → не отдаём частичные суммы.
  if (result.value === null) {
    throw new Error(formatFXUnavailable(result.missingCurrencies));
  }

  return result.value;
}
