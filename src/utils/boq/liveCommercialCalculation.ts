// UI preview only. Authoritative calculation is performed by backend/internal/calc
// (calc.CalculateBoqItemCost). This computes live commercial amounts for display
// and never persists — the Go BFF materialises commercial costs server-side.
// See docs/CALCULATION_SOURCE_OF_TRUTH.md.
import type { BoqItemFull, Tender, CurrencyType } from '../../lib/types';
import { getMarkupTactic } from '../../lib/api/markup';
import { getTenderById } from '../../lib/api/fi';
import {
  calculateBoqItemCost,
  loadMarkupParameters,
  loadPricingDistribution,
  loadSubcontractGrowthExclusions,
  resetTypeCoefficientsCache,
} from '../../services/markupTacticService';
import { totalAmountFX } from './currencyGuard';

type TenderRates = Pick<Tender, 'usd_rate' | 'eur_rate' | 'cny_rate'>;
type CalculationTactic = Parameters<typeof calculateBoqItemCost>[1];

export type LiveCommercialCalculationContext = {
  tenderRates: TenderRates;
  tactic: CalculationTactic | null;
  markupParameters: Map<string, number>;
  pricingDistribution: Awaited<ReturnType<typeof loadPricingDistribution>>;
  exclusions: Awaited<ReturnType<typeof loadSubcontractGrowthExclusions>>;
};

type LiveCommercialBoqItem = Pick<
  BoqItemFull,
  | 'id'
  | 'boq_item_type'
  | 'material_type'
  | 'detail_cost_category_id'
  | 'total_amount'
  | 'quantity'
  | 'unit_rate'
  | 'currency_type'
  | 'delivery_price_type'
  | 'delivery_amount'
  | 'consumption_coefficient'
  | 'parent_work_item_id'
  | 'total_commercial_material_cost'
  | 'total_commercial_work_cost'
>;

async function loadMarkupTacticById(tacticId: string | null | undefined): Promise<CalculationTactic | null> {
  if (!tacticId) {
    return null;
  }

  try {
    const tactic = await getMarkupTactic(tacticId);
    if (!tactic?.sequences) return null;
    return tactic as unknown as CalculationTactic;
  } catch {
    return null;
  }
}

export async function loadLiveCommercialCalculationContext(
  tenderId: string,
  tacticIdOverride?: string | null
): Promise<LiveCommercialCalculationContext> {
  const data = await getTenderById(tenderId);

  const tenderRates: TenderRates = {
    usd_rate: data?.usd_rate || 0,
    eur_rate: data?.eur_rate || 0,
    cny_rate: data?.cny_rate || 0,
  };

  const [tactic, markupParameters, pricingDistribution, exclusions] = await Promise.all([
    loadMarkupTacticById(tacticIdOverride ?? data?.markup_tactic_id),
    loadMarkupParameters(tenderId),
    loadPricingDistribution(tenderId),
    loadSubcontractGrowthExclusions(tenderId),
  ]);

  return {
    tenderRates,
    tactic,
    markupParameters,
    pricingDistribution,
    exclusions,
  };
}

export function resetLiveCommercialCalculationCache(): void {
  resetTypeCoefficientsCache();
}

/**
 * Fail-closed результат live-расчёта: при отсутствующем курсе валюты все суммы
 * = null, `unavailable=true`, а `missingCurrencies` перечисляет валюты. Верхний
 * уровень ОБЯЗАН проверить `unavailable` и не использовать 0/устаревшее
 * total_amount как актуальный live-результат.
 */
export type LiveCommercialAmounts =
  | {
      unavailable: false;
      missingCurrencies: never[];
      baseAmount: number;
      materialCost: number;
      workCost: number;
      commercialTotal: number;
      markupCoefficient: number;
    }
  | {
      unavailable: true;
      missingCurrencies: CurrencyType[];
      baseAmount: null;
      materialCost: null;
      workCost: null;
      commercialTotal: null;
      markupCoefficient: null;
    };

export function calculateLiveCommercialAmounts(
  item: LiveCommercialBoqItem,
  context: LiveCommercialCalculationContext
): LiveCommercialAmounts {
  // Fail-closed: нет курса → расчёт недоступен. НЕ подставляем 0 и НЕ используем
  // сохранённое total_amount как live-результат. Бэкенд — окончательный блокер.
  const base = totalAmountFX(item, context.tenderRates);
  if (base.value === null) {
    return {
      unavailable: true,
      missingCurrencies: base.missingCurrencies,
      baseAmount: null,
      materialCost: null,
      workCost: null,
      commercialTotal: null,
      markupCoefficient: null,
    };
  }

  const baseAmount = base.value;
  const liveCommercialCosts = context.tactic
    ? calculateBoqItemCost(
        {
          ...item,
          total_amount: baseAmount,
        },
        context.tactic,
        context.markupParameters,
        context.pricingDistribution,
        context.exclusions
      )
    : null;

  const materialCost = liveCommercialCosts?.materialCost ?? item.total_commercial_material_cost ?? 0;
  const workCost = liveCommercialCosts?.workCost ?? item.total_commercial_work_cost ?? 0;
  const commercialTotal = materialCost + workCost;

  return {
    unavailable: false,
    missingCurrencies: [],
    baseAmount,
    materialCost,
    workCost,
    commercialTotal,
    markupCoefficient: liveCommercialCosts?.markupCoefficient ?? (baseAmount > 0 ? commercialTotal / baseAmount : 1),
  };
}
