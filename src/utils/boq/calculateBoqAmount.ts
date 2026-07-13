// UI preview only. Authoritative calculation is performed by backend/internal/calc
// (calc.CalculateBoqItemTotalAmount). This is the single canonical TS mirror; the
// Go BFF recomputes total_amount server-side on create/update. Keep 1:1 with Go.
// See docs/CALCULATION_SOURCE_OF_TRUTH.md.
import type { BoqItemFull, CurrencyType } from '../../lib/types';

type CurrencyRates = {
  usd_rate?: number | null;
  eur_rate?: number | null;
  cny_rate?: number | null;
};

/**
 * Блокирующая доменная ошибка: у элемента иностранная валюта (USD/EUR/CNY), но
 * у тендера нет положительного курса. Никогда не подменять нулевой суммой.
 * 1:1 с backend calc.MissingFXRateError.
 */
export class MissingFXRateError extends Error {
  readonly code = 'MISSING_FX_RATE';
  readonly currency: CurrencyType;
  constructor(currency: CurrencyType) {
    super(`MISSING_FX_RATE: не задан курс валюты ${currency} для тендера`);
    this.name = 'MissingFXRateError';
    this.currency = currency;
  }
}

const WORK_TYPES = ['раб', 'суб-раб', 'раб-комп.'];
const MATERIAL_TYPES = ['мат', 'суб-мат', 'мат-комп.'];

export const isWorkBoqType = (type?: string | null): boolean =>
  Boolean(type && WORK_TYPES.includes(type));

export const isMaterialBoqType = (type?: string | null): boolean =>
  Boolean(type && MATERIAL_TYPES.includes(type));

export const getCurrencyRateFromTender = (
  currency: CurrencyType | null | undefined,
  rates: CurrencyRates
): number => {
  const requireRate = (rate: number | null | undefined, cur: CurrencyType): number => {
    if (!rate || rate <= 0) {
      // Блокирующая ошибка вместо тихого 0 (P0).
      throw new MissingFXRateError(cur);
    }
    return rate;
  };
  switch (currency) {
    case 'USD':
      return requireRate(rates.usd_rate, 'USD');
    case 'EUR':
      return requireRate(rates.eur_rate, 'EUR');
    case 'CNY':
      return requireRate(rates.cny_rate, 'CNY');
    case 'RUB':
    default:
      return 1;
  }
};

export const calculateDeliveryUnitCost = (
  item: Pick<BoqItemFull, 'unit_rate' | 'currency_type' | 'delivery_price_type' | 'delivery_amount'>,
  rates: CurrencyRates
): number => {
  const unitRate = Number(item.unit_rate) || 0;
  const rate = getCurrencyRateFromTender(item.currency_type, rates);

  if (item.delivery_price_type === 'не в цене') {
    return unitRate * rate * 0.03;
  }

  if (item.delivery_price_type === 'суммой') {
    return Number(item.delivery_amount) || 0;
  }

  return 0;
};

export const calculateBoqItemTotalAmount = (
  item: Pick<
    BoqItemFull,
    | 'boq_item_type'
    | 'quantity'
    | 'unit_rate'
    | 'currency_type'
    | 'delivery_price_type'
    | 'delivery_amount'
    | 'consumption_coefficient'
    | 'parent_work_item_id'
    | 'total_amount'
  >,
  rates: CurrencyRates
): number => {
  const quantity = Number(item.quantity) || 0;
  const unitRate = Number(item.unit_rate) || 0;
  const rate = getCurrencyRateFromTender(item.currency_type, rates);

  if (isWorkBoqType(item.boq_item_type)) {
    return quantity * unitRate * rate;
  }

  if (isMaterialBoqType(item.boq_item_type)) {
    const deliveryUnitCost = calculateDeliveryUnitCost(item, rates);
    const consumptionCoefficient = item.parent_work_item_id
      ? 1
      : Number(item.consumption_coefficient) || 1;

    return quantity * consumptionCoefficient * (unitRate * rate + deliveryUnitCost);
  }

  return Number(item.total_amount) || 0;
};
