// UI preview / fail-closed guards only. Authoritative calculation is performed by
// backend/internal/calc. These helpers wrap the TS mirror for display and block
// (never fall back to 0) when a currency rate is missing.
// See docs/CALCULATION_SOURCE_OF_TRUTH.md.
import type { CurrencyType } from '../../lib/types';
import {
  MissingFXRateError,
  calculateBoqItemTotalAmount,
  calculateDeliveryUnitCost,
} from './calculateBoqAmount';

type CurrencyRates = {
  usd_rate?: number | null;
  eur_rate?: number | null;
  cny_rate?: number | null;
};

type WithCurrency = { currency_type?: CurrencyType | null };

/**
 * Типизированный результат FX-расчёта. `value === null` ⇒ расчёт недоступен,
 * `missingCurrencies` перечисляет валюты без курса (дедуплицированы). Верхний
 * уровень обязан fail-closed: не подставлять 0/устаревшее и не суммировать
 * частично. См. combineFX.
 */
export type FXResult<T = number> = { value: T | null; missingCurrencies: CurrencyType[] };

const CURRENCY_ORDER: CurrencyType[] = ['USD', 'EUR', 'CNY'];

/** Дедупликация валют в стабильном порядке USD, EUR, CNY, затем прочие. */
export const dedupeCurrencies = (cs: readonly CurrencyType[]): CurrencyType[] => {
  const set = new Set(cs);
  return CURRENCY_ORDER.filter((c) => set.has(c)).concat(
    [...set].filter((c) => !CURRENCY_ORDER.includes(c)),
  );
};

/** «Расчёт недоступен: не задан курс USD и EUR». */
export const formatFXUnavailable = (currencies: readonly CurrencyType[]): string => {
  const cs = dedupeCurrencies(currencies);
  if (cs.length === 0) return 'Расчёт недоступен: не задан курс валюты';
  const list = cs.length === 1 ? cs[0] : `${cs.slice(0, -1).join(', ')} и ${cs[cs.length - 1]}`;
  return `Расчёт недоступен: не задан курс ${list}`;
};

/**
 * Ошибка экспорта: расчёт неполон из-за отсутствующего курса. Экспорт-функции
 * бросают её вместо создания файла с частичными/нулевыми значениями.
 */
export class MissingFXExportError extends Error {
  readonly code = 'MISSING_FX_RATE';
  readonly missingCurrencies: CurrencyType[];
  constructor(missingCurrencies: readonly CurrencyType[]) {
    super(formatFXUnavailable(missingCurrencies));
    this.name = 'MissingFXExportError';
    this.missingCurrencies = dedupeCurrencies(missingCurrencies);
  }
}

const FOREIGN: Record<string, keyof CurrencyRates> = {
  USD: 'usd_rate',
  EUR: 'eur_rate',
  CNY: 'cny_rate',
};

const rateMissing = (currency: CurrencyType | null | undefined, rates: CurrencyRates): boolean => {
  if (!currency) return false;
  const key = FOREIGN[currency];
  if (!key) return false; // RUB / прочее — курс не требуется
  const rate = rates[key];
  return !rate || rate <= 0;
};

/**
 * Возвращает различные иностранные валюты, встречающиеся среди позиций, для
 * которых у тендера нет положительного курса. Пусто → всё считается.
 * Использовать для одного Alert на экран (а не toast на строку).
 */
export const getMissingFXRates = (
  items: ReadonlyArray<WithCurrency>,
  rates: CurrencyRates
): CurrencyType[] => {
  const missing = new Set<CurrencyType>();
  for (const item of items) {
    if (rateMissing(item.currency_type, rates)) {
      missing.add(item.currency_type as CurrencyType);
    }
  }
  return Array.from(missing);
};

/**
 * Единое человекочитаемое сообщение об отсутствующих курсах, либо null.
 */
export const missingFXMessage = (
  items: ReadonlyArray<WithCurrency>,
  rates: CurrencyRates
): string | null => {
  const missing = getMissingFXRates(items, rates);
  if (missing.length === 0) return null;
  return formatFXUnavailable(missing);
};

/**
 * Типизированный FX-расчёт суммы строки. При отсутствующем курсе → value=null +
 * валюта в missingCurrencies (fail-closed для агрегаторов). Прочие ошибки
 * пробрасываются.
 */
export const totalAmountFX = (
  ...args: Parameters<typeof calculateBoqItemTotalAmount>
): FXResult => {
  try {
    return { value: calculateBoqItemTotalAmount(...args), missingCurrencies: [] };
  } catch (e) {
    if (e instanceof MissingFXRateError) return { value: null, missingCurrencies: [e.currency] };
    throw e;
  }
};

/**
 * Fail-closed суммирование FXResult: если ХОТЯ БЫ один элемент недоступен —
 * весь итог недоступен (value=null), валюты объединяются и дедуплицируются.
 * Нельзя пропустить ошибочный элемент и сложить остальные.
 */
export const combineFX = (results: readonly FXResult[]): FXResult => {
  const missing: CurrencyType[] = [];
  let sum = 0;
  let unavailable = false;
  for (const r of results) {
    if (r.value === null || r.missingCurrencies.length > 0) {
      unavailable = true;
      missing.push(...r.missingCurrencies);
    } else {
      sum += r.value;
    }
  }
  return unavailable
    ? { value: null, missingCurrencies: dedupeCurrencies(missing) }
    : { value: sum, missingCurrencies: [] };
};

/**
 * @deprecated fail-open. Используй totalAmountFX/combineFX для агрегаций.
 * Оставлен только для per-cell Excel-форматтеров, где строка помечается «—».
 * Возвращает null при отсутствующем курсе (не 0), прочие ошибки пробрасывает.
 */
export const safeTotalAmount = (
  ...args: Parameters<typeof calculateBoqItemTotalAmount>
): number | null => {
  try {
    return calculateBoqItemTotalAmount(...args);
  } catch (e) {
    if (e instanceof MissingFXRateError) return null;
    throw e;
  }
};

/**
 * Безопасная обёртка над calculateDeliveryUnitCost: null вместо тихого 0/исключения
 * при отсутствующем курсе.
 */
export const safeDeliveryUnitCost = (
  ...args: Parameters<typeof calculateDeliveryUnitCost>
): number | null => {
  try {
    return calculateDeliveryUnitCost(...args);
  } catch (e) {
    if (e instanceof MissingFXRateError) return null;
    throw e;
  }
};
