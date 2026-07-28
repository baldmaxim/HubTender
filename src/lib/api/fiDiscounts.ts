// Снижение коммерческой стоимости на «Финансовых показателях».
// Go: GET/PUT /api/v1/tenders/:id/fi-discounts.
//
// Хранятся ТОЛЬКО параметры итераций (сумма + позиции). Дельты прямых затрат
// пересчитываются на загрузке из каскада наценок тендера и никогда не
// сохраняются как деньги — см. docs/CALCULATION_SOURCE_OF_TRUTH.md.

import { apiFetch } from './client';

/** Одна итерация: снять `amount` рублей коммерческой стоимости с `positionIds`. */
export interface FiDiscountRule {
  amount: number;
  positionIds: string[];
}

/** Активный режим корректировки. Режимы взаимоисключающие. */
export type FiDiscountMode = 'discount' | 'zeroing';

export interface FiDiscountSettings {
  /** Тумблер «Применять снижение». false → страница считает как обычно. */
  enabled: boolean;
  /** Активный режим: снижение суммой ('discount') или обнуление строк ('zeroing'). */
  mode: FiDiscountMode;
  /** Итерации снижения (режим 'discount'). Применяются последовательно. */
  rules: FiDiscountRule[];
  /** Полностью обнуляемые позиции заказчика (режим 'zeroing'). */
  zeroedPositionIds: string[];
}

export const EMPTY_FI_DISCOUNTS: FiDiscountSettings = {
  enabled: false,
  mode: 'discount',
  rules: [],
  zeroedPositionIds: [],
};

function normalize(data: Partial<FiDiscountSettings> | null | undefined): FiDiscountSettings {
  if (!data) return { ...EMPTY_FI_DISCOUNTS, rules: [], zeroedPositionIds: [] };
  const rules = Array.isArray(data.rules) ? data.rules : [];
  return {
    enabled: Boolean(data.enabled),
    mode: data.mode === 'zeroing' ? 'zeroing' : 'discount',
    rules: rules
      .map((rule) => ({
        amount: Number(rule?.amount) || 0,
        positionIds: Array.isArray(rule?.positionIds) ? rule.positionIds.filter(Boolean) : [],
      }))
      // Итерация без суммы или без позиций ничего не делает — отбрасываем,
      // иначе она копилась бы в UI как «пустая» строка.
      .filter((rule) => rule.amount > 0 && rule.positionIds.length > 0),
    zeroedPositionIds: Array.isArray(data.zeroedPositionIds)
      ? data.zeroedPositionIds.filter(Boolean)
      : [],
  };
}

/**
 * Настройки снижения тендера. Тендер без строки в БД отдаётся бэкендом как
 * {enabled:false, rules:[]} — отдельного null-случая у вызывающего нет.
 *
 * Без cacheKey: страница дёргает это на каждом realtime-событии tender:<id>,
 * и залипший ETag-ответ показал бы чужое снижение как неприменённое.
 */
export async function getFiDiscounts(tenderId: string): Promise<FiDiscountSettings> {
  const res = await apiFetch<{ data: FiDiscountSettings | null }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/fi-discounts`,
    { cache: 'no-store' },
  );
  return normalize(res.data);
}

export async function saveFiDiscounts(
  tenderId: string,
  settings: FiDiscountSettings,
): Promise<FiDiscountSettings> {
  const res = await apiFetch<{ data: FiDiscountSettings | null }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/fi-discounts`,
    { method: 'PUT', body: JSON.stringify(settings) },
  );
  return normalize(res.data);
}
