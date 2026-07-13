import { useEffect, useState } from 'react';
import { message } from 'antd';
import { useRealtimeRefetch } from '../../../lib/realtime/useRealtimeRefetch';
import { useRealtimeAwareLoading } from '../../../lib/realtime/useRealtimeAwareLoading';
import type { Tender, CurrencyType } from '../../../lib/types';
import type { BoqItemWithCosts } from '../utils';
import { dedupeCurrencies } from '../../../utils/boq/currencyGuard';
import {
  calculateLiveCommercialAmounts,
  loadLiveCommercialCalculationContext,
  resetLiveCommercialCalculationCache,
} from '../../../utils/boq/liveCommercialCalculation';
import { fetchTenders as apiFetchTenders } from '../../../lib/api/tenders';
import { listMarkupTactics } from '../../../lib/api/markup';
import { listBoqItemsFullByTender } from '../../../lib/api/positions';
import { fetchPositionsWithCosts } from '../../../lib/api/positions';

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
  const [loading, setLoading] = useRealtimeAwareLoading(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string | undefined>();
  const [markupTactics, setMarkupTactics] = useState<MarkupTactic[]>([]);
  const [selectedTacticId, setSelectedTacticId] = useState<string | undefined>();
  const [boqItems, setBoqItems] = useState<BoqItemWithCosts[]>([]);
  const [clientPositions, setClientPositions] = useState<ClientPosition[]>([]);
  // Fail-closed: валюты без курса → перераспределение недоступно, показываем Alert.
  const [fxMissing, setFxMissing] = useState<CurrencyType[]>([]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenderId, selectedTacticId, tenders]);

  // Native WS hub — refetch boq items when the tender row changes.
  // Self-echo собственного сохранения результатов подавляется через
  // markRealtimeMutation в useSaveResults.
  useRealtimeRefetch(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    () => {
      if (selectedTenderId) {
        void loadBoqItems(selectedTenderId, selectedTacticId);
      }
    },
    { enabled: !!selectedTenderId },
  );

  const loadTenders = async () => {
    try {
      const all = await apiFetchTenders();
      const sorted = [...all].sort((a, b) =>
        (b.created_at || '').localeCompare(a.created_at || ''),
      );
      setTenders(sorted);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Не удалось загрузить список тендеров');
    }
  };

  const loadMarkupTactics = async () => {
    try {
      const tactics = await listMarkupTactics();
      const mapped: MarkupTactic[] = tactics.map((t) => ({
        id: t.id,
        name: t.name ?? '',
        is_global: Boolean(t.is_global),
      }));
      mapped.sort((a, b) => {
        if (a.is_global !== b.is_global) return a.is_global ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setMarkupTactics(mapped);
    } catch (error) {
      console.error('Ошибка загрузки тактик наценок:', error);
      message.error('Не удалось загрузить список тактик');
    }
  };

  const loadBoqItems = async (tenderId: string, tacticId?: string) => {
    setLoading(true);

    try {
      // Контекст расчёта и сырые boq_items независимы — грузим параллельно
      // (раньше шли последовательно: wall-clock = сумма двух запросов).
      const [calculationContext, rawRows] = await Promise.all([
        loadLiveCommercialCalculationContext(tenderId, tacticId),
        listBoqItemsFullByTender(tenderId),
      ]);
      resetLiveCommercialCalculationCache();

      const raw = rawRows as unknown as RedistributionBoqItem[];

      // Расчёт коммерческих сумм — синхронный O(items). На крупном тендере это длинная
      // блокирующая задача (фриз UI/анимаций при загрузке). Считаем чанками, уступая кадр
      // между ними; для ≤CHUNK элементов проход один — без накладных расходов.
      const CHUNK = 500;
      const allBoqItems: RedistributionBoqItem[] = [];
      const missing: CurrencyType[] = [];
      for (let i = 0; i < raw.length; i += CHUNK) {
        for (const item of raw.slice(i, i + CHUNK)) {
          const live = calculateLiveCommercialAmounts(
            item as unknown as Parameters<typeof calculateLiveCommercialAmounts>[0],
            calculationContext,
          );
          if (live.unavailable) {
            missing.push(...live.missingCurrencies);
            continue;
          }
          allBoqItems.push({
            ...item,
            total_commercial_material_cost: live.materialCost,
            total_commercial_work_cost: live.workCost,
          });
        }
        if (i + CHUNK < raw.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }

      // Fail-closed: нет курса → не показываем частичное перераспределение.
      if (missing.length > 0) {
        setFxMissing(dedupeCurrencies(missing));
        setBoqItems([]);
        return;
      }
      setFxMissing([]);
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
      const rows = await fetchPositionsWithCosts(tenderId);
      setClientPositions(rows as unknown as ClientPosition[]);
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
    fxMissing,
    loadBoqItems,
  };
}
