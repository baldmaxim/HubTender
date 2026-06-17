/**
 * Хук для загрузки и управления данными коммерции
 */

import { useState, useEffect, useMemo } from 'react';
import { message } from 'antd';
import type { Tender, BoqItem } from '../../../lib/supabase';
import type { PositionWithCommercialCost, MarkupTactic } from '../types';
import { calculateBoqItemTotalAmount } from '../../../utils/boq/calculateBoqAmount';
import {
  calculateBoqItemCost,
  loadMarkupParameters,
  loadPricingDistribution,
  loadSubcontractGrowthExclusions,
  resetTypeCoefficientsCache,
} from '../../../services/markupTacticService';
import { fetchTenders } from '../../../lib/api/tenders';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';
import { listMarkupTactics, getMarkupTactic } from '../../../lib/api/markup';
import { getTenderById, listAllBoqItemsForTender } from '../../../lib/api/fi';
import { loadTenderInsurance } from '../../../lib/api/insurance';
import { fetchPositionsWithCosts } from '../../../lib/api/positions';
import { loadRedistributionResults } from '../../../lib/api/redistributions';
import { computeLeafPositionIds } from '../../../utils/positions/leafPositions';
import {
  applyRedistributionPipeline,
  computeInsuranceTotal,
  type PreparedRow,
} from '../../../services/redistributionPipeline';
import { buildResultRows } from '../../CostRedistribution/utils/buildResultRows';
import { computeCumulativePositionDeltas } from '../../CostRedistribution/utils/calculatePositionAdjustment';
import type { ClientPosition as RedistributionClientPosition } from '../../CostRedistribution/hooks';
import type { RedistributionResult } from '../../CostRedistribution/utils/calculateDistribution';
import type { PositionAdjustmentRule } from '../../CostRedistribution/types/positionAdjustment';

type CommerceBoqItem = Pick<
  BoqItem,
  'id' |
  'tender_id' |
  'client_position_id' |
  'sort_number' |
  'boq_item_type' |
  'material_type' |
  'quantity' |
  'unit_rate' |
  'currency_type' |
  'delivery_price_type' |
  'delivery_amount' |
  'consumption_coefficient' |
  'parent_work_item_id' |
  'total_amount' |
  'detail_cost_category_id' |
  'total_commercial_material_cost' |
  'total_commercial_work_cost'
>;

type TenderRates = Pick<Tender, 'usd_rate' | 'eur_rate' | 'cny_rate'>;
type CalculationTactic = Parameters<typeof calculateBoqItemCost>[1];

type CommerceCalculationContext = {
  tenderRates: TenderRates;
  tactic: CalculationTactic | null;
  markupParameters: Map<string, number>;
  pricingDistribution: Awaited<ReturnType<typeof loadPricingDistribution>>;
  exclusions: Awaited<ReturnType<typeof loadSubcontractGrowthExclusions>>;
};

type AggregatedPositionLoadResult = {
  positions: PositionWithCommercialCost[];
  referenceTotal: number;
  boqItems: CommerceBoqItem[] | null;
};

type PositionAccumulator = {
  baseTotal: number;
  commercialTotal: number;
  materialCostTotal: number;
  workCostTotal: number;
  itemsCount: number;
};

function applyLeafFlags(positions: PositionWithCommercialCost[]): PositionWithCommercialCost[] {
  const leafIds = computeLeafPositionIds(positions);
  return positions.map((position) => ({
    ...position,
    is_leaf: leafIds.has(position.id),
  }));
}

function buildPositionsFromBoqItems(
  clientPositions: PositionWithCommercialCost[],
  boqItems: CommerceBoqItem[],
  context: CommerceCalculationContext
): AggregatedPositionLoadResult {
  const totalsByPosition = new Map<string, PositionAccumulator>();
  let referenceTotal = 0;

  resetTypeCoefficientsCache();

  // Перезаписываем total_commercial_*_cost в boqItems live-calc значениями,
  // чтобы общий redistributionPipeline (buildResultRows) видел те же per-item
  // числа, что и CR. Без этого для позиций без category-redistribution
  // (когда snapshot не содержит строки на boq_item) КП использовал бы
  // stored DB-значения, а CR — свежий live-calc, и итоги расходились.
  const enrichedBoqItems: CommerceBoqItem[] = [];

  for (const item of boqItems) {
    const itemBase = calculateBoqItemTotalAmount(item, context.tenderRates);
    const liveCommercialCosts = context.tactic
      ? calculateBoqItemCost(
          {
            ...item,
            total_amount: itemBase,
          },
          context.tactic,
          context.markupParameters,
          context.pricingDistribution,
          context.exclusions
        )
      : null;
    const itemMaterial = liveCommercialCosts?.materialCost ?? item.total_commercial_material_cost ?? 0;
    const itemWork = liveCommercialCosts?.workCost ?? item.total_commercial_work_cost ?? 0;

    enrichedBoqItems.push({
      ...item,
      total_commercial_material_cost: itemMaterial,
      total_commercial_work_cost: itemWork,
    });

    referenceTotal += itemBase;

    const currentTotals = totalsByPosition.get(item.client_position_id) || {
      baseTotal: 0,
      commercialTotal: 0,
      materialCostTotal: 0,
      workCostTotal: 0,
      itemsCount: 0,
    };

    currentTotals.baseTotal += itemBase;
    currentTotals.commercialTotal += itemMaterial + itemWork;
    currentTotals.materialCostTotal += itemMaterial;
    currentTotals.workCostTotal += itemWork;
    currentTotals.itemsCount += 1;

    totalsByPosition.set(item.client_position_id, currentTotals);
  }

  const positions = clientPositions.map((position) => {
    const totals = totalsByPosition.get(position.id);
    const baseTotal = totals?.baseTotal || 0;
    const commercialTotal = totals?.commercialTotal || 0;

    return {
      ...position,
      base_total: baseTotal,
      commercial_total: commercialTotal,
      material_cost_total: totals?.materialCostTotal || 0,
      work_cost_total: totals?.workCostTotal || 0,
      markup_percentage: baseTotal > 0 ? commercialTotal / baseTotal : 1,
      items_count: totals?.itemsCount || 0,
    } as PositionWithCommercialCost;
  });

  return {
    positions: applyLeafFlags(positions),
    referenceTotal,
    boqItems: enrichedBoqItems,
  };
}

// Все позиции тендера (Go: /api/v1/tenders/:id/positions/with-costs,
// ORDER BY position_number,id — leaf-flag алгоритм сохраняется).
async function loadClientPositions(tenderId: string): Promise<PositionWithCommercialCost[]> {
  const rows = await fetchPositionsWithCosts(tenderId);
  return rows as unknown as PositionWithCommercialCost[];
}

// Все boq_items тендера (Go: /api/v1/tenders/:id/boq-items-flat).
// Порядок не важен — агрегация по позициям и сумма referenceTotal.
async function loadBoqItems(tenderId: string): Promise<CommerceBoqItem[]> {
  const rows = await listAllBoqItemsForTender(tenderId);
  return rows as unknown as CommerceBoqItem[];
}

async function loadMarkupTacticById(tacticId: string | null | undefined): Promise<CalculationTactic | null> {
  if (!tacticId) {
    return null;
  }

  try {
    const tactic = await getMarkupTactic(tacticId);
    if (!tactic?.sequences) {
      return null;
    }
    return tactic as unknown as CalculationTactic;
  } catch (error) {
    console.warn('Не удалось загрузить тактику наценок для коммерческого расчета:', error);
    return null;
  }
}

async function loadCommerceCalculationContext(tenderId: string): Promise<CommerceCalculationContext> {
  const tender = await getTenderById(tenderId);

  const tenderRates: TenderRates = {
    usd_rate: tender?.usd_rate || 0,
    eur_rate: tender?.eur_rate || 0,
    cny_rate: tender?.cny_rate || 0,
  };

  const [tactic, markupParameters, pricingDistribution, exclusions] = await Promise.all([
    loadMarkupTacticById(tender?.markup_tactic_id),
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

async function loadInsuranceTotal(tenderId: string): Promise<number> {
  const data = await loadTenderInsurance(tenderId);
  return computeInsuranceTotal(data);
}

export function useCommerceData() {
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string | undefined>();
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [positions, setPositions] = useState<PositionWithCommercialCost[]>([]);
  const [boqItems, setBoqItems] = useState<CommerceBoqItem[] | null>(null);
  const [markupTactics, setMarkupTactics] = useState<MarkupTactic[]>([]);
  const [selectedTacticId, setSelectedTacticId] = useState<string | undefined>();
  const [tacticChanged, setTacticChanged] = useState(false);
  const [referenceTotal, setReferenceTotal] = useState<number>(0);
  const [insuranceTotal, setInsuranceTotal] = useState<number>(0);

  // Загрузка списка тендеров и тактик
  useEffect(() => {
    loadTenders();
    loadMarkupTactics();
  }, []);

  // Загрузка позиций при выборе тендера
  useEffect(() => {
    if (selectedTenderId) {
      loadPositions(selectedTenderId);
    } else {
      setPositions([]);
      setBoqItems(null);
      setReferenceTotal(0);
      setInsuranceTotal(0);
    }
  }, [selectedTenderId]);

  useEffect(() => {
    if (!selectedTenderId) {
      setSelectedTacticId(undefined);
      setTacticChanged(false);
      return;
    }

    const tender = tenders.find(t => t.id === selectedTenderId);
    if (tender?.markup_tactic_id) {
      setSelectedTacticId(tender.markup_tactic_id);
      setTacticChanged(false);
    } else {
      setSelectedTacticId(undefined);
    }
  }, [selectedTenderId, tenders]);

  // Native WS hub — подтягиваем материализованные коммерческие стоимости после
  // серверного авто-пересчёта (смена тактики/наценок шлёт NOTIFY в tender:{id}).
  // Эхо здесь желаемое (recalc асинхронный), поэтому self-echo guard не нужен.
  useRealtimeTopic(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    () => {
      if (selectedTenderId) void loadPositions(selectedTenderId);
    },
    !!selectedTenderId,
  );

  const loadTenders = async () => {
    try {
      const data = await fetchTenders();
      setTenders(data || []);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Не удалось загрузить список тендеров');
    }
  };

  const loadMarkupTactics = async () => {
    try {
      const data = await listMarkupTactics();
      setMarkupTactics((data || []) as unknown as MarkupTactic[]);
    } catch (error) {
      console.error('Ошибка загрузки тактик наценок:', error);
      message.error('Не удалось загрузить список тактик');
    }
  };

  const loadPositions = async (tenderId: string) => {
    setLoading(true);
    setBoqItems(null);

    try {
      const [positionsResult, nextInsuranceTotal] = await Promise.all([
        (async (): Promise<AggregatedPositionLoadResult> => {
          const [clientPositions, allBoqItems, calculationContext] = await Promise.all([
            loadClientPositions(tenderId),
            loadBoqItems(tenderId),
            loadCommerceCalculationContext(tenderId),
          ]);

          return buildPositionsFromBoqItems(clientPositions, allBoqItems, calculationContext);
        })(),
        loadInsuranceTotal(tenderId),
      ]);

      setPositions(positionsResult.positions);
      setReferenceTotal(positionsResult.referenceTotal);
      setInsuranceTotal(nextInsuranceTotal);
      setBoqItems(positionsResult.boqItems);
    } catch (error) {
      console.error('Ошибка загрузки позиций:', error);
      message.error('Не удалось загрузить позиции заказчика');
    } finally {
      setLoading(false);
    }
  };

  // Единый источник правды для per-position сумм работ + страхования — страница
  // «Перераспределение Затрат». Если для выбранной пары (тендер, тактика) есть
  // сохранённый снимок — прогоняем тот же pipeline (category-redistribution →
  // position-adjustments → smartRound → insurance) что и CR, и переписываем
  // work_cost_total + insurance_share позиций. Иначе live-calc остаётся как есть.
  useEffect(() => {
    if (!selectedTenderId || !selectedTacticId) return;
    if (!boqItems || positions.length === 0) return;

    let cancelled = false;

    (async () => {
      let snapshot: Awaited<ReturnType<typeof loadRedistributionResults>> = null;
      try {
        snapshot = await loadRedistributionResults(selectedTenderId, selectedTacticId);
      } catch (error) {
        console.warn('Не удалось загрузить снимок перераспределения для Commerce:', error);
        snapshot = null;
      }
      if (cancelled) return;

      if (!snapshot || snapshot.results.length === 0) {
        // Снимка нет — сбросить пометки, чтобы Commerce работал на live calc.
        setPositions((prev) =>
          prev.some((p) => p.from_redistribution)
            ? prev.map((p) => ({
                ...p,
                insurance_share: undefined,
                from_redistribution: false,
              }))
            : prev,
        );
        return;
      }

      const boqItemsByPosition = new Map<
        string,
        Array<{
          id: string;
          client_position_id: string;
          total_commercial_work_cost: number;
          total_commercial_material_cost: number;
        }>
      >();
      for (const item of boqItems) {
        const existing = boqItemsByPosition.get(item.client_position_id);
        const entry = {
          id: item.id,
          client_position_id: item.client_position_id,
          total_commercial_work_cost: item.total_commercial_work_cost ?? 0,
          total_commercial_material_cost: item.total_commercial_material_cost ?? 0,
        };
        if (existing) existing.push(entry);
        else boqItemsByPosition.set(item.client_position_id, [entry]);
      }

      const resultsMap = new Map<string, RedistributionResult>();
      for (const r of snapshot.results) resultsMap.set(r.boq_item_id, r);

      const categoryLevelRows = buildResultRows(
        positions as unknown as RedistributionClientPosition[],
        boqItemsByPosition,
        resultsMap,
      );

      const rules = snapshot.redistribution_rules as
        | (Record<string, unknown> & {
            position_adjustments?: PositionAdjustmentRule[];
            position_adjustment?: PositionAdjustmentRule;
          })
        | null;
      const ruleArray = Array.isArray(rules?.position_adjustments)
        ? (rules?.position_adjustments as PositionAdjustmentRule[])
        : rules?.position_adjustment
          ? [rules.position_adjustment as PositionAdjustmentRule]
          : [];

      const adjustmentBaseRows = categoryLevelRows.map((row) => ({
        position_id: row.position_id,
        total_works_after: row.total_works_after,
      }));
      const { cumulative: deltas } = computeCumulativePositionDeltas(
        adjustmentBaseRows,
        ruleArray,
      );

      const prepared = applyRedistributionPipeline({
        categoryLevelRows,
        positionAdjustmentDeltas: deltas,
        insuranceTotal,
      });

      const byId = new Map<string, PreparedRow>();
      for (const r of prepared.rows) byId.set(r.position_id, r);

      setPositions((prev) =>
        prev.map((p) => {
          const row = byId.get(p.id);
          if (!row) return p;
          const newWorkCost = row.total_works_after_pre_insurance;
          // Сохраняем согласованность производных полей: commercial_total =
          // material_cost_total + work_cost_total (без страхования — оно
          // отображается как отдельная надбавка через insurance_share).
          const newCommercialTotal = (p.material_cost_total || 0) + newWorkCost;
          const newMarkup =
            (p.base_total || 0) > 0 ? newCommercialTotal / (p.base_total || 1) : 1;
          return {
            ...p,
            work_cost_total: newWorkCost,
            commercial_total: newCommercialTotal,
            markup_percentage: newMarkup,
            insurance_share: row.insurance_share,
            from_redistribution: true,
          };
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
    // positions.length достаточно для триггера «позиции готовы»; полный объект positions
    // умышленно опущен, чтобы не зациклить эффект (мы сами вызываем setPositions внутри).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenderId, selectedTacticId, boqItems, insuranceTotal, positions.length]);

  const handleTacticChange = (tacticId: string) => {
    setSelectedTacticId(tacticId);
    // Проверяем, изменилась ли тактика относительно сохраненной в тендере
    const tender = tenders.find(t => t.id === selectedTenderId);
    setTacticChanged(tacticId !== tender?.markup_tactic_id);
  };

  const syncTenderMarkupTactic = (tenderId: string, tacticId: string) => {
    setTenders((prevTenders) =>
      prevTenders.map((tender) =>
        tender.id === tenderId
          ? { ...tender, markup_tactic_id: tacticId }
          : tender
      )
    );
  };

  // Рассчитываем итоговые суммы
  const totals = useMemo(() => {
    let baseTotal = 0;
    let commercialTotal = 0;

    for (const position of positions) {
      baseTotal += position.base_total || 0;
      commercialTotal += position.commercial_total || 0;
    }

    const difference = commercialTotal - baseTotal;
    const markupPercentage = baseTotal > 0 ? (difference / baseTotal) * 100 : 0;

    return {
      base: baseTotal,
      commercial: commercialTotal,
      difference,
      markupPercentage
    };
  }, [positions]);

  return {
    loading,
    calculating,
    setCalculating,
    tenders,
    selectedTenderId,
    setSelectedTenderId,
    selectedTenderTitle,
    setSelectedTenderTitle,
    selectedVersion,
    setSelectedVersion,
    positions,
    boqItems,
    setPositions,
    markupTactics,
    selectedTacticId,
    setSelectedTacticId,
    tacticChanged,
    setTacticChanged,
    loadTenders,
    loadPositions,
    handleTacticChange,
    syncTenderMarkupTactic,
    totals,
    referenceTotal,
    insuranceTotal,
  };
}
