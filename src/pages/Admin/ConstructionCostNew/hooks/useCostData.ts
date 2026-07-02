import { useState, useEffect } from 'react';
import { message } from 'antd';
import { type Tender } from '../../../../lib/supabase';
import { useRealtimeAwareLoading } from '../../../../lib/realtime/useRealtimeAwareLoading';
import { fetchTenders as apiFetchTenders } from '../../../../lib/api/tenders';
import { listDetailCostCategoriesWithCategory } from '../../../../lib/api/costs';
import { listBoqItemsFullByTender } from '../../../../lib/api/positions';
import {
  listConstructionCostVolumes,
  upsertConstructionCostVolume,
} from '../../../../lib/api/constructionCostVolumes';
import { getErrorMessage } from '../../../../utils/errors';
import { useRealtimeRefetch } from '../../../../lib/realtime/useRealtimeRefetch';
import {
  loadLiveCommercialCalculationContext,
  resetLiveCommercialCalculationCache,
} from '../../../../utils/boq/liveCommercialCalculation';
import type { BoqItemForCost, CostRow, TenderOption } from '../types';
import { aggregateBoqCosts } from '../utils/aggregateBoqCosts';
import { buildCostRows } from '../utils/buildCostRows';

// Обратная совместимость: типы страницы переехали в ../types.ts,
// компоненты продолжают импортировать их из hooks/useCostData.
export type { CostRow, TenderOption } from '../types';

export const useCostData = () => {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [loading, setLoading] = useRealtimeAwareLoading(false);
  const [data, setData] = useState<CostRow[]>([]);
  const [costType, setCostType] = useState<'base' | 'commercial'>('base');
  const [, setGroupVolumes] = useState<Map<string, number>>(new Map());

  // Архивные тендеры отображаются в фильтре для всех пользователей
  const shouldFilterArchived = false;

  const getTenderTitles = (): TenderOption[] => {
    const uniqueTitles = new Map<string, TenderOption>();

    const filteredTenders = shouldFilterArchived
      ? tenders.filter(t => !t.is_archived)
      : tenders;

    filteredTenders.forEach(tender => {
      if (!uniqueTitles.has(tender.title)) {
        uniqueTitles.set(tender.title, {
          value: tender.title,
          label: tender.title,
          clientName: tender.client_name,
        });
      }
    });

    return Array.from(uniqueTitles.values());
  };

  const getVersionsForTitle = (title: string) => {
    const filtered = shouldFilterArchived
      ? tenders.filter(t => t.title === title && !t.is_archived)
      : tenders.filter(t => t.title === title);

    return filtered.map(t => ({
      value: t.version || 1,
      label: `Версия ${t.version || 1}`,
    }));
  };

  const handleTenderTitleChange = (title: string) => {
    setSelectedTenderTitle(title);
    // Автоматически выбираем последнюю версию нового тендера
    const versionsOfTitle = tenders
      .filter(t => t.title === title)
      .sort((a, b) => (b.version || 1) - (a.version || 1));
    if (versionsOfTitle.length > 0) {
      const latest = versionsOfTitle[0];
      setSelectedVersion(latest.version || 1);
      setSelectedTenderId(latest.id);
    } else {
      setSelectedVersion(null);
      setSelectedTenderId(null);
      setData([]);
    }
  };

  const handleVersionChange = (version: number) => {
    setSelectedVersion(version);
    const tender = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (tender) {
      setSelectedTenderId(tender.id);
    }
  };

  const fetchTenders = async () => {
    try {
      const all = await apiFetchTenders();
      const sorted = [...all].sort((a, b) =>
        (b.created_at || '').localeCompare(a.created_at || ''),
      );
      setTenders(sorted);
    } catch (error) {
      message.error('Ошибка загрузки тендеров: ' + getErrorMessage(error));
    }
  };

  const fetchConstructionCosts = async () => {
    if (!selectedTenderId) return;

    setLoading(true);
    try {
      const categoriesWithJoined = await listDetailCostCategoriesWithCategory();
      const categories = [...categoriesWithJoined].sort(
        (a, b) => (a.order_num ?? 0) - (b.order_num ?? 0),
      );

      const volumes = await listConstructionCostVolumes(selectedTenderId);

      const volumeMap = new Map<string, number>();
      const notesMap = new Map<string, string>();
      const groupVolumesMap = new Map<string, number>();
      const groupNotesMap = new Map<string, string>();

      volumes.forEach((v) => {
        if (v.detail_cost_category_id) {
          volumeMap.set(v.detail_cost_category_id, v.volume || 0);
          if (v.notes) notesMap.set(v.detail_cost_category_id, v.notes);
        } else if (v.group_key) {
          groupVolumesMap.set(v.group_key, v.volume || 0);
          if (v.notes) groupNotesMap.set(v.group_key, v.notes);
        }
      });

      console.log('Loaded group volumes from DB:', Array.from(groupVolumesMap.entries()));

      const calculationContext = await loadLiveCommercialCalculationContext(selectedTenderId);
      resetLiveCommercialCalculationCache();

      const boqItems = (await listBoqItemsFullByTender(selectedTenderId)) as unknown as BoqItemForCost[];

      const costMap = aggregateBoqCosts(boqItems, costType, calculationContext);

      const rows = buildCostRows({
        categories,
        costMap,
        volumeMap,
        notesMap,
        groupVolumesMap,
        groupNotesMap,
        costType,
      });

      setData(rows);
    } catch (error) {
      console.error('Ошибка загрузки затрат:', error);
      message.error(`Не удалось загрузить данные затрат: ${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  // Native WS hub (Go BFF) — invalidate-and-refetch on tender row change.
  // markLocalMutation() в обработчиках ниже подавляет self-echo собственных
  // правок объёмов/заметок (upsert → NOTIFY → WS-эхо через ~200 мс).
  const { markLocalMutation } = useRealtimeRefetch(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    () => {
      void fetchConstructionCosts();
    },
  );

  const handleVolumeChange = async (value: number | null, record: CostRow) => {
    if (value === null || value === record.volume) return;

    markLocalMutation();
    try {
      if (record.detail_cost_category_id) {
        await upsertConstructionCostVolume({
          tender_id: selectedTenderId!,
          detail_cost_category_id: record.detail_cost_category_id,
          volume: value,
        });

        setData((prevData) => {
          const updateVolume = (rows: CostRow[]): CostRow[] =>
            rows.map((row) => {
              if (row.key === record.key) return { ...row, volume: value };
              if (row.children) return { ...row, children: updateVolume(row.children) };
              return row;
            });
          return updateVolume(prevData);
        });

        message.success('Объем сохранен');
      } else if (record.is_category || record.is_location) {
        await upsertConstructionCostVolume({
          tender_id: selectedTenderId!,
          group_key: record.key,
          volume: value,
        });

        setGroupVolumes((prev) => {
          const newMap = new Map(prev);
          newMap.set(record.key, value);
          return newMap;
        });

        setData((prevData) => {
          const updateVolume = (rows: CostRow[]): CostRow[] =>
            rows.map((row) => {
              if (row.key === record.key) return { ...row, volume: value };
              if (row.children) return { ...row, children: updateVolume(row.children) };
              return row;
            });
          return updateVolume(prevData);
        });
        message.success('Объем группы сохранен');
      }
    } catch (error) {
      message.error('Ошибка сохранения: ' + getErrorMessage(error));
    }
  };

  const handleNotesChange = async (value: string, record: CostRow) => {
    markLocalMutation();
    try {
      if (record.detail_cost_category_id) {
        await upsertConstructionCostVolume({
          tender_id: selectedTenderId!,
          detail_cost_category_id: record.detail_cost_category_id,
          volume: record.volume,
          notes: value || null,
        });
      } else if (record.is_category || record.is_location) {
        await upsertConstructionCostVolume({
          tender_id: selectedTenderId!,
          group_key: record.key,
          volume: record.volume,
          notes: value || null,
        });
      }

      setData((prevData) => {
        const updateNotes = (rows: CostRow[]): CostRow[] =>
          rows.map((row) => {
            if (row.key === record.key) return { ...row, notes: value || undefined };
            if (row.children) return { ...row, children: updateNotes(row.children) };
            return row;
          });
        return updateNotes(prevData);
      });
    } catch (error) {
      message.error('Ошибка сохранения примечания: ' + getErrorMessage(error));
    }
  };

  useEffect(() => {
    fetchTenders();
  }, []);

  useEffect(() => {
    if (selectedTenderId) {
      setGroupVolumes(new Map());
      fetchConstructionCosts();
    }
    // fetchConstructionCosts is defined outside this effect; intentionally excluded to avoid refetch loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenderId, costType]);

  return {
    tenders,
    selectedTenderId,
    selectedTenderTitle,
    selectedVersion,
    loading,
    data,
    costType,
    setCostType,
    setSelectedTenderId,
    setSelectedTenderTitle,
    setSelectedVersion,
    setData,
    getTenderTitles,
    getVersionsForTitle,
    handleTenderTitleChange,
    handleVersionChange,
    fetchConstructionCosts,
    handleVolumeChange,
    handleNotesChange,
  };
};
