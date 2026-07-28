// Типы механизма снижения коммерческой стоимости на «Финансовых показателях».
import type { DirectCostTotals } from '../types';

export type { FiDiscountRule, FiDiscountSettings } from '../../../lib/api/fiDiscounts';

/**
 * Снижаемые прямые затраты одной позиции Заказчика + её коммерческий эквивалент.
 *
 * `totals` — только те BOQ-элементы позиции, которые целиком уходят в колонку
 * «работы» КП (см. utils/reducibleItems.ts). Основные материалы сюда не попадают,
 * поэтому «Итого материалы» на Перераспределении при снижении не меняется.
 */
export interface PositionReducible {
  positionId: string;
  totals: DirectCostTotals;
  /** grandTotal каскада от `totals` при insuranceCost = 0. */
  commercial: number;
}

export type FiDiscountErrorCode =
  | 'amount_required'
  | 'positions_required'
  | 'nothing_reducible'
  | 'amount_exceeds_reducible';

export interface FiDiscountValidationError {
  code: FiDiscountErrorCode;
  message: string;
}

/**
 * Состояние снижения, отдаваемое страницей наружу.
 * null — снижение выключено или не настроено: страница считает как обычно.
 */
export interface DiscountContext {
  /** Активный режим — для подписи сводки («Снижение» / «Обнулено»). */
  mode: 'discount' | 'zeroing';
  /** ИТОГО без снижения — левая колонка сводки «Было». */
  baseGrandTotal: number;
  /** ИТОГО после снижения — правая колонка сводки «Стало». */
  reducedGrandTotal: number;
  /** Фактически снятая сумма (может быть меньше запрошенной при ошибках итераций). */
  appliedAmount: number;
  /** Доля снижения по позициям, 0..1 — для drill-down диаграмм и подсветки строк. */
  alphaByPosition: Map<string, number>;
  /** Итерации, по которым не удалось применить снижение (индекс → ошибки). */
  errorsByRule: Map<number, FiDiscountValidationError[]>;
  /**
   * Множитель прямых затрат конкретного BOQ-элемента после снижения (0..1).
   *
   * Нужен drill-down диаграммам: они грузят boq_items своим запросом и без
   * этого показывали бы досниженные суммы, расходясь с ИТОГО.
   */
  itemScale: (
    positionId: string | null | undefined,
    boqItemType: string | null | undefined,
    materialType: string | null | undefined,
  ) => number;
}

/** Результат применения набора итераций к прямым затратам тендера. */
export interface FiDiscountApplication {
  /** Прямые затраты тендера после всех итераций — вход для computeIndicators. */
  reducedTotals: DirectCostTotals;
  /** Суммарная доля снижения по каждой затронутой позиции, 0..1. */
  alphaByPosition: Map<string, number>;
  /** Фактически снятая коммерческая стоимость (Σ amount применённых итераций). */
  appliedAmount: number;
  /** Ошибки по каждой итерации: индекс правила → список ошибок. */
  errorsByRule: Map<number, FiDiscountValidationError[]>;
}
