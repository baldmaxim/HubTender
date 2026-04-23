import { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import {
  supabase,
  type Tender,
  type ClientPosition,
  type CurrencyType,
  type DeliveryPriceType,
} from '../../../lib/supabase';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';

type PositionCountMap = Record<string, { works: number; materials: number; total: number }>;

type RawBoqItem = {
  client_position_id: string;
  boq_item_type: string;
  total_amount: number | null;
  quantity: number | null;
  unit_rate: number | null;
  currency_type: CurrencyType | null;
  delivery_price_type: DeliveryPriceType | null;
  delivery_amount: number | null;
  consumption_coefficient: number | null;
  parent_work_item_id: string | null;
};

async function loadAllPositions(tenderId: string): Promise<ClientPosition[]> {
  const all: ClientPosition[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('client_positions')
      .select('*')
      .eq('tender_id', tenderId)
      .order('position_number', { ascending: true })
      .range(from, from + 999);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    all.push(...data);

    if (data.length < 1000) {
      break;
    }

    from += 1000;
  }

  return all;
}

async function loadAllBoqItems(tenderId: string): Promise<RawBoqItem[]> {
  const all: RawBoqItem[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('boq_items')
      .select(`
        client_position_id,
        boq_item_type,
        total_amount,
        quantity,
        unit_rate,
        currency_type,
        delivery_price_type,
        delivery_amount,
        consumption_coefficient,
        parent_work_item_id
      `)
      .eq('tender_id', tenderId)
      .range(from, from + 999);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    all.push(...(data as RawBoqItem[]));

    if (data.length < 1000) {
      break;
    }

    from += 1000;
  }

  return all;
}

async function loadTenderById(tenderId: string): Promise<Tender | null> {
  const { data, error } = await supabase
    .from('tenders')
    .select('*')
    .eq('id', tenderId)
    .single();

  if (error) {
    throw error;
  }

  return (data as Tender) || null;
}

function getCurrencyRate(
  currency: CurrencyType | null | undefined,
  tender: Pick<Tender, 'usd_rate' | 'eur_rate' | 'cny_rate'>
): number {
  switch (currency) {
    case 'USD':
      return tender.usd_rate || 0;
    case 'EUR':
      return tender.eur_rate || 0;
    case 'CNY':
      return tender.cny_rate || 0;
    case 'RUB':
    default:
      return 1;
  }
}

function calculateBoqItemAmount(
  item: RawBoqItem,
  tender: Pick<Tender, 'usd_rate' | 'eur_rate' | 'cny_rate'>
): number {
  const quantity = Number(item.quantity) || 0;
  const unitRate = Number(item.unit_rate) || 0;
  const rate = getCurrencyRate(item.currency_type, tender);

  if (['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type)) {
    return quantity * unitRate * rate;
  }

  if (['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type)) {
    let deliveryPrice = 0;

    if (item.delivery_price_type === 'не в цене') {
      deliveryPrice = unitRate * rate * 0.03;
    } else if (item.delivery_price_type === 'суммой') {
      deliveryPrice = Number(item.delivery_amount) || 0;
    }

    const consumptionCoefficient = item.parent_work_item_id
      ? 1
      : Number(item.consumption_coefficient) || 1;

    return quantity * consumptionCoefficient * (unitRate * rate + deliveryPrice);
  }

  return Number(item.total_amount) || 0;
}

function buildPositionStats(
  boqItems: RawBoqItem[],
  tender: Pick<Tender, 'usd_rate' | 'eur_rate' | 'cny_rate'> | null
): { counts: PositionCountMap; totalSum: number } {
  const counts: PositionCountMap = {};
  let totalSum = 0;

  for (const item of boqItems) {
    if (!counts[item.client_position_id]) {
      counts[item.client_position_id] = { works: 0, materials: 0, total: 0 };
    }

    if (['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type)) {
      counts[item.client_position_id].works++;
    } else if (['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type)) {
      counts[item.client_position_id].materials++;
    }

    const amount = tender
      ? calculateBoqItemAmount(item, tender)
      : (Number(item.total_amount) || 0);

    counts[item.client_position_id].total += amount;
    totalSum += amount;
  }

  return { counts, totalSum };
}

export const useClientPositions = () => {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);
  const [clientPositions, setClientPositions] = useState<ClientPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [positionCounts, setPositionCounts] = useState<PositionCountMap>({});
  const [totalSum, setTotalSum] = useState<number>(0);
  const [leafPositionIndices, setLeafPositionIndices] = useState<Set<string>>(new Set());

  const fetchTenders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tenders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      setTenders((data as Tender[]) || []);
    } catch (error: any) {
      message.error('Ошибка загрузки тендеров: ' + error.message);
    }
  }, []);

  useEffect(() => {
    void fetchTenders();
  }, [fetchTenders]);

  const computeLeafPositions = (positions: ClientPosition[]): Set<string> => {
    const leafIds = new Set<string>();

    positions.forEach((position, index) => {
      if (index === positions.length - 1) {
        leafIds.add(position.id);
        return;
      }

      const currentLevel = position.hierarchy_level || 0;
      let nextIndex = index + 1;

      while (nextIndex < positions.length && positions[nextIndex].is_additional) {
        nextIndex++;
      }

      if (nextIndex >= positions.length) {
        leafIds.add(position.id);
        return;
      }

      if (currentLevel >= (positions[nextIndex].hierarchy_level || 0)) {
        leafIds.add(position.id);
      }
    });

    return leafIds;
  };

  const fetchClientPositions = useCallback(async (tenderId: string) => {
    setLoading(true);

    try {
      const [positions, boqItems, tender] = await Promise.all([
        loadAllPositions(tenderId),
        loadAllBoqItems(tenderId),
        loadTenderById(tenderId),
      ]);

      setClientPositions(positions);
      setLeafPositionIndices(computeLeafPositions(positions));

      if (tender) {
        setSelectedTender(tender);
      }

      const { counts, totalSum: nextTotalSum } = buildPositionStats(boqItems, tender);
      setPositionCounts(counts);
      setTotalSum(nextTotalSum);
    } catch (error: any) {
      message.error('Ошибка загрузки позиций: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Native WS hub (Go BFF) path.
  const wsActive = useRealtimeTopic(
    selectedTender?.id ? `tender:${selectedTender.id}` : null,
    () => {
      if (selectedTender?.id) {
        void fetchTenders();
        void fetchClientPositions(selectedTender.id);
      }
    },
  );

  // Supabase Realtime fallback.
  useEffect(() => {
    if (!selectedTender?.id || wsActive) {
      return;
    }

    const channel = supabase
      .channel(`client-positions-tender-${selectedTender.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tenders',
          filter: `id=eq.${selectedTender.id}`,
        },
        () => {
          void fetchTenders();
          void fetchClientPositions(selectedTender.id);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchClientPositions, fetchTenders, selectedTender?.id, wsActive]);

  return {
    tenders,
    selectedTender,
    setSelectedTender,
    clientPositions,
    setClientPositions,
    loading,
    setLoading,
    positionCounts,
    setPositionCounts,
    totalSum,
    setTotalSum,
    leafPositionIndices,
    fetchClientPositions,
  };
};
