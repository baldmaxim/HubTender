import { loadPricingDistribution } from '../../../../services/markupTactic/calculation';
import type { getTenderById, BoqItemWithPosition } from '../../../../lib/api/fi';
import type { DirectCostTotals, MarkupCoefficients } from '../../types';
import { buildGrowthExclusionSets } from '../../utils/aggregateDirectCosts';
import type { listSubcontractGrowthExclusions } from '../../../../lib/api/fi';
import { buildReduciblePositionTotals, toPositionReducibles } from './positionTotals';
import { createReduciblePredicate } from './reducibleItems';
import { computeMarkupMultipliers, commercialOf, type MarkupMultipliers } from './markupMultipliers';
import type { PositionReducible } from '../types';

type TenderFI = Awaited<ReturnType<typeof getTenderById>>;
type SubcontractExclusions = Awaited<ReturnType<typeof listSubcontractGrowthExclusions>>;

/**
 * Всё, что нужно, чтобы считать и применять снижение по тендеру.
 * Строится один раз на загрузку тендера и мемоизируется вызывающим.
 */
export interface DiscountWorkspace {
  /** Снижаемые прямые затраты + коммерческий эквивалент по позициям. */
  reducibles: Map<string, PositionReducible>;
  /** Множители «рубль прямых затрат корзины → рублей ИТОГО». */
  multipliers: MarkupMultipliers;
  /** Сколько всего можно снять по тендеру — потолок для UI. */
  totalReducible: number;
  /**
   * Тот же критерий снижаемости, что применялся при сборке `reducibles`.
   * Нужен наружу для drill-down диаграмм: они грузят boq_items отдельным
   * запросом и должны масштабировать ровно те же элементы.
   */
  isReducible: (
    boqItemType: string | null | undefined,
    materialType: string | null | undefined,
  ) => boolean;
}

export interface BuildWorkspaceInput {
  tenderId: string;
  tender: TenderFI;
  boqItems: BoqItemWithPosition[];
  exclusions: SubcontractExclusions;
  coeffs: MarkupCoefficients;
}

/**
 * Собрать рабочее пространство снижения.
 *
 * Единственный сетевой запрос здесь — настройки распределения ценообразования
 * (одна строка). boq_items страница уже загрузила, повторно не тянем.
 * Всё остальное — один проход по элементам плюс восемь прогонов каскада.
 */
export const buildDiscountWorkspace = async (
  input: BuildWorkspaceInput,
): Promise<DiscountWorkspace> => {
  const { tenderId, tender, boqItems, exclusions, coeffs } = input;

  const distribution = await loadPricingDistribution(tenderId);
  const excluded = buildGrowthExclusionSets(exclusions);

  const totalsByPosition = buildReduciblePositionTotals(boqItems, tender, excluded, distribution);
  const multipliers = computeMarkupMultipliers(coeffs);
  const reducibles = toPositionReducibles(totalsByPosition, (totals: DirectCostTotals) =>
    commercialOf(totals, multipliers),
  );

  let totalReducible = 0;
  for (const entry of reducibles.values()) {
    totalReducible += entry.commercial;
  }

  return {
    reducibles,
    multipliers,
    totalReducible,
    isReducible: createReduciblePredicate(distribution),
  };
};
