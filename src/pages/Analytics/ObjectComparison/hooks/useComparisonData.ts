import { useState, useEffect, useCallback, useMemo } from 'react';
import { message } from 'antd';
import type { Tender, CurrencyType } from '../../../../lib/types';
import { dedupeCurrencies, formatFXUnavailable } from '../../../../utils/boq/currencyGuard';
import { fetchTenders as apiFetchTenders, fetchTendersByIds as apiFetchTendersByIds } from '../../../../lib/api/tenders';
import { apiFetch } from '../../../../lib/api/client';
import type { BoqItemForComparison, CostType, ComparisonRow, NotesMap, VolumeMaps } from '../types';
import { getErrorMessage } from '../../../../utils/errors';
import { buildHierarchy } from '../utils/buildComparisonHierarchy';
import { fetchBoqItems, fetchNotes, fetchVolumes } from '../utils/fetchComparisonData';

export function useComparisonData() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenders, setSelectedTenders] = useState<(string | null)[]>([null, null]);
  const [tenderInfos, setTenderInfos] = useState<(Tender | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [comparisonData, setComparisonData] = useState<ComparisonRow[]>([]);
  const [costType, setCostType] = useState<CostType>('base');

  const [rawItemsAll, setRawItemsAll] = useState<BoqItemForComparison[][] | null>(null);
  const [volumeMapsAll, setVolumeMapsAll] = useState<VolumeMaps[] | null>(null);
  const [notesMap, setNotesMap] = useState<NotesMap>(new Map());
  // Тендеры, по которым реально загружено сравнение (на них вешаем realtime).
  const [loadedTenderIds, setLoadedTenderIds] = useState<string[]>([]);
  // Fail-closed: валюты без курса → сравнение недоступно, показываем Alert.
  const [fxMissing, setFxMissing] = useState<CurrencyType[]>([]);

  // Площадь по СП — знаменатель показателя «₽ на м² общей площади». Порядок
  // соответствует loadedTenderIds, потому что tenderInfos собирается из того же
  // списка. Не заполнена — показатель останется нулевым (см. calcPerUnit).
  const areaSpAll = useMemo(
    () => tenderInfos.map((t) => t?.area_sp ?? null),
    [tenderInfos],
  );

  useEffect(() => {
    fetchTendersData();
  }, []);

  useEffect(() => {
    if (rawItemsAll) {
      const data = buildHierarchy(
        rawItemsAll,
        costType,
        volumeMapsAll || undefined,
        notesMap,
        areaSpAll,
      );
      setComparisonData(data);
    }
  }, [costType, rawItemsAll, volumeMapsAll, notesMap, areaSpAll]);

  const fetchTendersData = async () => {
    try {
      const data = await apiFetchTenders();
      setTenders(data);
    } catch (error) {
      message.error('Ошибка загрузки тендеров: ' + getErrorMessage(error));
    }
  };

  const setSelectedTender = (idx: number, value: string | null) => {
    setSelectedTenders(prev => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const addTender = () => {
    setSelectedTenders(prev => [...prev, null]);
  };

  const removeTender = (idx: number) => {
    if (selectedTenders.length <= 2) return;
    setSelectedTenders(prev => prev.filter((_, i) => i !== idx));
  };

  // Общий загрузчик. silent=true — для realtime-обновления (без спиннера и
  // тостов). Пересборка comparisonData выполняется эффектом по rawItemsAll.
  const runLoad = useCallback(async (validTenders: string[], silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      const tendersResult = await apiFetchTendersByIds(validTenders);

      // Последовательно по тендерам — общий module-level кэш коэффициентов в
      // calculateBoqItemCost не допускает конкурентного расчёта (см. fetchBoqItems).
      const itemsAll: BoqItemForComparison[][] = [];
      const missing: CurrencyType[] = [];
      for (const id of validTenders) {
        const res = await fetchBoqItems(id);
        itemsAll.push(res.items);
        missing.push(...res.missingCurrencies);
      }

      // Fail-closed: хотя бы у одного тендера нет курса → сравнение недоступно.
      if (missing.length > 0) {
        const deduped = dedupeCurrencies(missing);
        setFxMissing(deduped);
        setRawItemsAll(null);
        setComparisonData([]);
        if (!silent) message.error(formatFXUnavailable(deduped));
        return;
      }
      setFxMissing([]);

      const volsAll = await Promise.all(validTenders.map(id => fetchVolumes(id)));

      const tendersById = new Map(tendersResult.map(t => [t.id, t]));
      setTenderInfos(validTenders.map(id => tendersById.get(id) ?? null));

      let loadedNotes: NotesMap = new Map();
      if (validTenders.length === 2) {
        loadedNotes = await fetchNotes(validTenders[0], validTenders[1]);
      }

      setRawItemsAll(itemsAll);
      setVolumeMapsAll(volsAll);
      setNotesMap(loadedNotes);
      setLoadedTenderIds(validTenders);
      if (!silent) message.success('Данные успешно загружены');
    } catch (error) {
      if (silent) {
        console.error('Ошибка авто-обновления сравнения:', error);
      } else {
        message.error('Ошибка загрузки данных: ' + getErrorMessage(error));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadComparisonData = useCallback(async () => {
    const validTenders = selectedTenders.filter(Boolean) as string[];
    if (validTenders.length < 2) {
      message.warning('Выберите минимум два тендера для сравнения');
      return;
    }
    if (new Set(validTenders).size !== validTenders.length) {
      message.warning('Выберите разные тендеры для сравнения');
      return;
    }
    await runLoad(validTenders, false);
  }, [selectedTenders, runLoad]);

  // Тихая перезагрузка уже загруженного сравнения — вызывается realtime-подпиской,
  // когда у любого из сравниваемых тендеров поменялись BOQ/наценки.
  const refreshComparison = useCallback(() => {
    if (loadedTenderIds.length >= 2) {
      void runLoad(loadedTenderIds, true);
    }
  }, [loadedTenderIds, runLoad]);

  const saveNote = useCallback(async (
    categoryName: string,
    detailKey: string | null,
    note: string
  ) => {
    const validTenders = selectedTenders.filter(Boolean) as string[];
    if (validTenders.length !== 2) return;
    const [tenderId1, tenderId2] = validTenders;

    try {
      // Go BFF апсертит обе ориентации пары + created_by из JWT.
      await apiFetch<void>('/api/v1/comparison-notes', {
        method: 'POST',
        body: JSON.stringify({
          tender_id_1: tenderId1,
          tender_id_2: tenderId2,
          cost_category_name: categoryName,
          detail_category_key: detailKey,
          note,
        }),
      });

      const mapKey = detailKey || `main__${categoryName}`;
      setNotesMap(prev => {
        const next = new Map(prev);
        if (note) next.set(mapKey, note);
        else next.delete(mapKey);
        return next;
      });
    } catch (error) {
      message.error('Ошибка сохранения примечания: ' + getErrorMessage(error));
    }
  }, [selectedTenders]);

  const tenderTotals = comparisonData.reduce<number[]>(
    (acc, row) => {
      row.tenders.forEach((t, i) => { acc[i] = (acc[i] || 0) + t.total; });
      return acc;
    },
    []
  );

  return {
    tenders,
    selectedTenders, setSelectedTender, addTender, removeTender,
    tenderInfos,
    loading,
    comparisonData,
    costType, setCostType,
    loadComparisonData,
    loadedTenderIds,
    refreshComparison,
    tenderTotals,
    saveNote,
    fxMissing,
  };
}
