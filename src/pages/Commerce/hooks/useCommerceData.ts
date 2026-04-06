/**
 * Хук для загрузки и управления данными коммерции
 */

import { useState, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
import type { Tender, BoqItem } from '../../../lib/supabase';
import type { PositionWithCommercialCost, MarkupTactic } from '../types';

type CommerceBoqItem = Pick<
  BoqItem,
  'id' |
  'tender_id' |
  'client_position_id' |
  'sort_number' |
  'boq_item_type' |
  'material_type' |
  'total_amount' |
  'detail_cost_category_id' |
  'total_commercial_material_cost' |
  'total_commercial_work_cost'
>;

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

type RpcPositionWithCostsRow = {
  id: string;
  tender_id: string;
  position_number: number;
  unit_code: string | null;
  volume: number | null;
  client_note: string | null;
  item_no: string | null;
  work_name: string;
  manual_volume: number | null;
  manual_note: string | null;
  hierarchy_level: number | null;
  is_additional: boolean | null;
  parent_position_id: string | null;
  total_material: number | null;
  total_works: number | null;
  material_cost_per_unit: number | null;
  work_cost_per_unit: number | null;
  total_commercial_material: number | null;
  total_commercial_work: number | null;
  total_commercial_material_per_unit: number | null;
  total_commercial_work_per_unit: number | null;
  created_at: string;
  updated_at: string;
  base_total: number | null;
  commercial_total: number | null;
  material_cost_total: number | null;
  work_cost_total: number | null;
  markup_percentage: number | null;
  items_count: number | null;
};

async function fetchAllPages<T>(
  loader: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
  batchSize: number = 1000
): Promise<T[]> {
  const allRows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await loader(from, from + batchSize - 1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows.push(...data);

    if (data.length < batchSize) {
      break;
    }

    from += batchSize;
  }

  return allRows;
}

function computeLeafPositionIds(positions: Pick<PositionWithCommercialCost, 'id' | 'hierarchy_level' | 'is_additional'>[]): Set<string> {
  const leafIds = new Set<string>();

  positions.forEach((position, index) => {
    if (position.is_additional) {
      leafIds.add(position.id);
      return;
    }

    if (index === positions.length - 1) {
      leafIds.add(position.id);
      return;
    }

    const currentLevel = position.hierarchy_level || 0;
    let nextIndex = index + 1;

    while (nextIndex < positions.length && positions[nextIndex].is_additional) {
      nextIndex++;
    }

    if (nextIndex >= positions.length || currentLevel >= (positions[nextIndex].hierarchy_level || 0)) {
      leafIds.add(position.id);
    }
  });

  return leafIds;
}

function applyLeafFlags(positions: PositionWithCommercialCost[]): PositionWithCommercialCost[] {
  const leafIds = computeLeafPositionIds(positions);
  return positions.map((position) => ({
    ...position,
    is_leaf: leafIds.has(position.id),
  }));
}

function buildPositionsFromBoqItems(
  clientPositions: PositionWithCommercialCost[],
  boqItems: CommerceBoqItem[]
): AggregatedPositionLoadResult {
  const totalsByPosition = new Map<string, PositionAccumulator>();
  let referenceTotal = 0;

  for (const item of boqItems) {
    const itemBase = item.total_amount || 0;
    const itemMaterial = item.total_commercial_material_cost || 0;
    const itemWork = item.total_commercial_work_cost || 0;

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
    boqItems,
  };
}

async function loadClientPositionsFallback(tenderId: string): Promise<PositionWithCommercialCost[]> {
  return fetchAllPages(async (from, to) =>
    supabase
      .from('client_positions')
      .select('*')
      .eq('tender_id', tenderId)
      .order('position_number')
      .range(from, to)
  ) as Promise<PositionWithCommercialCost[]>;
}

async function loadBoqItemsFallback(tenderId: string): Promise<CommerceBoqItem[]> {
  return fetchAllPages(async (from, to) =>
    supabase
      .from('boq_items')
      .select(`
        id,
        tender_id,
        client_position_id,
        sort_number,
        boq_item_type,
        material_type,
        total_amount,
        detail_cost_category_id,
        total_commercial_material_cost,
        total_commercial_work_cost
      `)
      .eq('tender_id', tenderId)
      .order('sort_number')
      .order('id')
      .range(from, to)
  ) as Promise<CommerceBoqItem[]>;
}

async function loadPositionsViaRpc(tenderId: string): Promise<AggregatedPositionLoadResult> {
  const { data, error } = await supabase.rpc('get_positions_with_costs', {
    p_tender_id: tenderId,
  });

  if (error) {
    throw error;
  }

  const positions = applyLeafFlags(
    ((data || []) as RpcPositionWithCostsRow[]).map((row) => ({
      ...row,
      base_total: row.base_total || 0,
      commercial_total: row.commercial_total || 0,
      material_cost_total: row.material_cost_total || 0,
      work_cost_total: row.work_cost_total || 0,
      markup_percentage: row.markup_percentage || 1,
      items_count: row.items_count || 0,
    }))
  );

  const referenceTotal = positions.reduce((sum, position) => sum + (position.base_total || 0), 0);

  return {
    positions,
    referenceTotal,
    boqItems: null,
  };
}

async function loadInsuranceTotal(tenderId: string): Promise<number> {
  const { data } = await supabase
    .from('tender_insurance')
    .select('judicial_pct, total_pct, apt_price_m2, apt_area, parking_price_m2, parking_area, storage_price_m2, storage_area')
    .eq('tender_id', tenderId)
    .maybeSingle();

  if (!data) {
    return 0;
  }

  const apt = (data.apt_price_m2 || 0) * (data.apt_area || 0);
  const park = (data.parking_price_m2 || 0) * (data.parking_area || 0);
  const stor = (data.storage_price_m2 || 0) * (data.storage_area || 0);

  return (apt + park + stor) * ((data.judicial_pct || 0) / 100) * ((data.total_pct || 0) / 100);
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

  const loadTenders = async () => {
    try {
      const { data, error } = await supabase
        .from('tenders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTenders(data || []);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Не удалось загрузить список тендеров');
    }
  };

  const loadMarkupTactics = async () => {
    try {
      const { data, error } = await supabase
        .from('markup_tactics')
        .select('*')
        .order('is_global', { ascending: false })
        .order('name');

      if (error) throw error;
      setMarkupTactics(data || []);
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
          try {
            return await loadPositionsViaRpc(tenderId);
          } catch (rpcError) {
            console.warn('RPC get_positions_with_costs is unavailable, falling back to client aggregation:', rpcError);
            const [clientPositions, allBoqItems] = await Promise.all([
              loadClientPositionsFallback(tenderId),
              loadBoqItemsFallback(tenderId),
            ]);

            return buildPositionsFromBoqItems(clientPositions, allBoqItems);
          }
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
