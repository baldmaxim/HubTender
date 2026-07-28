// UI display / Excel-export only — считает предпросмотр и вход для каскада ФП.
// Персистятся ТОЛЬКО параметры итераций (сумма + позиции); дельты пересчитываются
// на каждой загрузке. Authoritative money math — backend/internal/calc.
// См. docs/CALCULATION_SOURCE_OF_TRUTH.md.
import type { DirectCostTotals } from '../../types';
import type {
  FiDiscountRule,
  FiDiscountValidationError,
  FiDiscountApplication,
  PositionReducible,
} from '../types';
import {
  commercialOf,
  addScaledTotals,
  sumTotals,
  type MarkupMultipliers,
} from './markupMultipliers';
import { emptyDirectCostTotals } from '../../utils/aggregateDirectCosts';

/** Копейка: ниже этого порога расхождения считаем нулём. */
const EPSILON = 0.01;

const formatMoney = (value: number): string =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Сколько ещё можно снять с выбранных позиций в текущем состоянии.
 *
 * Это НЕ вся колонка «ИТОГО работы»: наценка основных материалов физически
 * лежит в ней, но снять её нельзя, не тронув базу материалов, а базу трогать
 * нельзя — иначе поедет «Итого материалы». Отсюда потолок ниже, чем колонка.
 */
export const reducibleCapacity = (
  positionIds: Iterable<string>,
  reducibles: Map<string, PositionReducible>,
  alphaByPosition: Map<string, number>,
): number => {
  let capacity = 0;
  for (const id of positionIds) {
    const entry = reducibles.get(id);
    if (!entry) continue;
    const alreadyTaken = alphaByPosition.get(id) ?? 0;
    capacity += entry.commercial * Math.max(0, 1 - alreadyTaken);
  }
  return capacity;
};

export const validateDiscountRule = (
  rule: FiDiscountRule,
  reducibles: Map<string, PositionReducible>,
  alphaByPosition: Map<string, number>,
): FiDiscountValidationError[] => {
  const errors: FiDiscountValidationError[] = [];

  if (!(rule.amount > 0)) {
    errors.push({ code: 'amount_required', message: 'Введите сумму снижения больше нуля' });
  }
  if (rule.positionIds.length === 0) {
    errors.push({ code: 'positions_required', message: 'Выберите строки или разделы для снижения' });
  }
  if (errors.length > 0) {
    return errors;
  }

  const capacity = reducibleCapacity(rule.positionIds, reducibles, alphaByPosition);
  if (capacity <= EPSILON) {
    errors.push({
      code: 'nothing_reducible',
      message:
        'В выбранных строках нечего снижать: их стоимость целиком приходится на прямые ' +
        'затраты основных материалов, которые снижать нельзя',
    });
    return errors;
  }
  if (rule.amount - capacity > EPSILON) {
    errors.push({
      code: 'amount_exceeds_reducible',
      message:
        `Сумма снижения ${formatMoney(rule.amount)} превышает доступную ` +
        `к снижению стоимость выбранных строк ${formatMoney(capacity)}`,
    });
  }

  return errors;
};

/**
 * Применить итерации снижения к прямым затратам тендера.
 *
 * Каждая итерация: α = amount / (доступная коммерческая стоимость выборки),
 * дальше из общих прямых затрат вычитается α-доля прямых затрат выборки.
 * Каскад однороден, поэтому ИТОГО падает ровно на `amount`.
 *
 * Итерации применяются последовательно: следующая считается уже от сниженного
 * состояния, как `computeCumulativePositionDeltas` на Перераспределении.
 * Невалидная итерация пропускается (её ошибки уходят в `errorsByRule`), но не
 * ломает остальные — иначе одна опечатка обнуляла бы всю настройку тендера.
 */
export const applyDiscountRules = (
  baseTotals: DirectCostTotals,
  rules: FiDiscountRule[],
  reducibles: Map<string, PositionReducible>,
  multipliers: MarkupMultipliers,
): FiDiscountApplication => {
  const alphaByPosition = new Map<string, number>();
  const errorsByRule = new Map<number, FiDiscountValidationError[]>();
  let reducedTotals = baseTotals;
  let appliedAmount = 0;

  rules.forEach((rule, index) => {
    const errors = validateDiscountRule(rule, reducibles, alphaByPosition);
    if (errors.length > 0) {
      errorsByRule.set(index, errors);
      return;
    }

    // Остаточные (ещё не снятые) прямые затраты выборки.
    const remainingParts: DirectCostTotals[] = [];
    for (const id of rule.positionIds) {
      const entry = reducibles.get(id);
      if (!entry) continue;
      const remainingShare = Math.max(0, 1 - (alphaByPosition.get(id) ?? 0));
      if (remainingShare <= 0) continue;
      remainingParts.push(scaleTotals(entry.totals, remainingShare));
    }
    if (remainingParts.length === 0) return;

    const selectionTotals = sumTotals(remainingParts);
    const selectionCommercial = commercialOf(selectionTotals, multipliers);
    if (selectionCommercial <= EPSILON) return;

    // Клампим на случай превышения в пределах EPSILON: без этого α > 1 увёл бы
    // прямые затраты в минус.
    const alpha = Math.min(1, rule.amount / selectionCommercial);

    reducedTotals = addScaledTotals(reducedTotals, selectionTotals, -alpha);
    appliedAmount += selectionCommercial * alpha;

    for (const id of rule.positionIds) {
      if (!reducibles.has(id)) continue;
      const prev = alphaByPosition.get(id) ?? 0;
      // Доля снимается от ОСТАТКА позиции, поэтому накопленная доля от
      // исходной стоимости растёт как prev + (1 - prev) · alpha.
      alphaByPosition.set(id, Math.min(1, prev + (1 - prev) * alpha));
    }
  });

  return { reducedTotals, alphaByPosition, appliedAmount, errorsByRule };
};

/** Умножить поля каскада на коэффициент (не мутирует вход). */
function scaleTotals(totals: DirectCostTotals, k: number): DirectCostTotals {
  if (k === 1) return totals;
  return addScaledTotals(emptyDirectCostTotals(), totals, k);
}
