import { useEffect, useState } from 'react';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';
import type { Tender } from '../../../lib/supabase';
import type { BoqItemWithCosts } from '../utils';
import {
  calculateLiveCommercialAmounts,
  loadLiveCommercialCalculationContext,
  resetLiveCommercialCalculationCache,
} from '../../../utils/boq/liveCommercialCalculation';

export interface MarkupTactic {
  id: string;
  name: string;
  is_global: boolean;
}

export interface ClientPosition {
  id: string;
  tender_id: string;
  position_number: number;
  section_number: string | null;
  position_name: string;
  unit_code: string;
  volume: number | null;
  manual_volume: number | null;
  manual_note: string | null;
  item_no: string | null;
  work_name: string;
  parent_position_id: string | null;
  is_additional: boolean;
  hierarchy_level: number;
}

type RedistributionBoqItem = BoqItemWithCosts & {
  material_type?: string | null;
  quantity?: number | null;
  unit_rate?: number | null;
  currency_type?: string | null;
  delivery_price_type?: string | null;
  delivery_amount?: number | null;
  consumption_coefficient?: number | null;
  parent_work_item_id?: string | null;
  total_amount?: number | null;
};

export function useRedistributionData() {
  const [loading, setLoading] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string | undefined>();
  const [markupTactics, setMarkupTactics] = useState<MarkupTactic[]>([]);
  const [selectedTacticId, setSelectedTacticId] = useState<string | undefined>();
  const [boqItems, setBoqItems] = useState<BoqItemWithCosts[]>([]);
  const [clientPositions, setClientPositions] = useState<ClientPosition[]>([]);

  useEffect(() => {
    void loadTenders();
    void loadMarkupTactics();
  }, []);

  useEffect(() => {
    if (!selectedTenderId) {
      setBoqItems([]);
      setClientPositions([]);
      return;
    }

    void loadBoqItems(selectedTenderId, selectedTacticId);
    void loadClientPositions(selectedTenderId);

    const tender = tenders.find((item) => item.id === selectedTenderId);
    if (tender?.markup_tactic_id && !selectedTacticId) {
      setSelectedTacticId(tender.markup_tactic_id);
    }
  }, [selectedTenderId, selectedTacticId, tenders]);

  // Native WS hub (Go BFF) path.
  const wsActive = useRealtimeTopic(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    () => {
      if (selectedTenderId) {
        void loadBoqItems(selectedTenderId, selectedTacticId);
      }
    },
    !!selectedTenderId,
  );

  // Supabase Realtime fallback.
  useEffect(() => {
    if (!selectedTenderId || wsActive) {
      return;
    }

    const channel = supabase
      .channel(`redistribution_tender_${selectedTenderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tenders',
          filter: `id=eq.${selectedTenderId}`,
        },
        () => {
          void loadBoqItems(selectedTenderId, selectedTacticId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedTenderId, selectedTacticId, wsActive]);

  const loadTenders = async () => {
    try {
      // Страница использует только id/title/version для dropdown и
      // markup_tactic_id для авто-выбора схемы — узкая проекция
      // экономит сеть и десериализацию на тендерах с большим JSONB-контентом.
      const { data, error } = await supabase
        .from('tenders')
        .select('id, title, version, markup_tactic_id, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      setTenders((data ?? []) as unknown as Tender[]);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Не удалось загрузить список тендеров');
    }
  };

  const loadMarkupTactics = async () => {
    try {
      const { data, error } = await supabase
        .from('markup_tactics')
        .select('id, name, is_global')
        .order('is_global', { ascending: false })
        .order('name');

      if (error) {
        throw error;
      }

      setMarkupTactics(data || []);
    } catch (error) {
      console.error('Ошибка загрузки тактик наценок:', error);
      message.error('Не удалось загрузить список тактик');
    }
  };

  const loadBoqItems = async (tenderId: string, tacticId?: string) => {
    setLoading(true);

    try {
      const calculationContext = await loadLiveCommercialCalculationContext(tenderId, tacticId);
      const allBoqItems: RedistributionBoqItem[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      resetLiveCommercialCalculationCache();

      while (hasMore) {
        const { data, error } = await supabase
          .from('boq_items')
          .select(`
            id,
            client_position_id,
            detail_cost_category_id,
            boq_item_type,
            material_type,
            quantity,
            unit_rate,
            currency_type,
            delivery_price_type,
            delivery_amount,
            consumption_coefficient,
            parent_work_item_id,
            total_amount,
            total_commercial_work_cost,
            total_commercial_material_cost
          `)
          .eq('tender_id', tenderId)
          .range(from, from + batchSize - 1);

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) {
          hasMore = false;
          continue;
        }

        const liveItems = data.map((item) => {
          const { materialCost, workCost } = calculateLiveCommercialAmounts(
            item,
            calculationContext
          );

          return {
            ...item,
            total_commercial_material_cost: materialCost,
            total_commercial_work_cost: workCost,
          } as RedistributionBoqItem;
        });

        allBoqItems.push(...liveItems);
        from += batchSize;
        hasMore = data.length === batchSize;
      }

      setBoqItems(allBoqItems);
    } catch (error) {
      console.error('Ошибка загрузки BOQ элементов:', error);
      message.error('Не удалось загрузить элементы BOQ');
    } finally {
      setLoading(false);
    }
  };

  const loadClientPositions = async (tenderId: string) => {
    try {
      const allPositions: ClientPosition[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('client_positions')
          .select('*')
          .eq('tender_id', tenderId)
          .order('position_number', { ascending: true })
          .range(from, from + batchSize - 1);

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) {
          hasMore = false;
          continue;
        }

        allPositions.push(...(data as ClientPosition[]));
        from += batchSize;
        hasMore = data.length === batchSize;
      }

      setClientPositions(allPositions);
    } catch (error) {
      console.error('Ошибка загрузки позиций заказчика:', error);
      message.error('Не удалось загрузить позиции заказчика');
    }
  };

  const handleTacticChange = (tacticId: string) => {
    setSelectedTacticId(tacticId);
  };

  return {
    loading,
    tenders,
    selectedTenderId,
    setSelectedTenderId,
    markupTactics,
    selectedTacticId,
    handleTacticChange,
    boqItems,
    clientPositions,
    loadBoqItems,
  };
}
