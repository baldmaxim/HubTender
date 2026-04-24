import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import { supabase, type Tender } from '../../../../lib/supabase';
import { fetchTenders as apiFetchTenders, fetchTendersByIds as apiFetchTendersByIds } from '../../../../lib/api/tenders';
import type { CostType, ComparisonRow, TenderCosts } from '../types';
import { getErrorMessage } from '../../../../utils/errors';

const MATERIAL_TYPES = ['мат', 'суб-мат', 'мат-комп.'];
const WORK_TYPES = ['раб', 'суб-раб', 'раб-комп.'];

function makeEmptyTenderCosts(): TenderCosts {
  return { materials: 0, works: 0, total: 0, mat_per_unit: 0, work_per_unit: 0, total_per_unit: 0, volume: 0 };
}

function makeRow(key: string, category: string, numTenders: number, isMain?: boolean): ComparisonRow {
  return {
    key,
    category,
    is_main_category: isMain,
    tenders: Array.from({ length: numTenders }, makeEmptyTenderCosts),
  };
}

function calcPerUnit(row: ComparisonRow): void {
  for (const t of row.tenders) {
    t.mat_per_unit = t.volume > 0 ? t.materials / t.volume : 0;
    t.work_per_unit = t.volume > 0 ? t.works / t.volume : 0;
    t.total_per_unit = t.volume > 0 ? t.total / t.volume : 0;
  }
}

async function fetchVolumes(tenderId: string): Promise<{ detailMap: Map<string, number>; groupMap: Map<string, number> }> {
  const { data, error } = await supabase
    .from('construction_cost_volumes')
    .select('*')
    .eq('tender_id', tenderId);

  if (error) throw error;

  const detailMap = new Map<string, number>();
  const groupMap = new Map<string, number>();
  for (const v of (data || [])) {
    if (v.detail_cost_category_id) {
      detailMap.set(v.detail_cost_category_id, v.volume || 0);
    } else if (v.group_key) {
      groupMap.set(v.group_key, v.volume || 0);
    }
  }
  return { detailMap, groupMap };
}

async function fetchBoqItems(tenderId: string) {
  let items: any[] = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('boq_items')
      .select(`
        total_amount,
        boq_item_type,
        total_commercial_material_cost,
        total_commercial_work_cost,
        detail_cost_category_id,
        detail_cost_categories!inner(
          name,
          location,
          cost_categories(name)
        ),
        client_positions!inner(tender_id)
      `)
      .eq('client_positions.tender_id', tenderId)
      .range(from, from + batchSize - 1);

    if (error) throw error;

    if (data && data.length > 0) {
      items = [...items, ...data];
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }
  return items;
}

type NotesMap = Map<string, string>;

async function fetchNotes(tenderId1: string, tenderId2: string): Promise<NotesMap> {
  const { data, error } = await supabase
    .from('comparison_notes')
    .select('tender_id_1, tender_id_2, cost_category_name, detail_category_key, note')
    .or(
      `and(tender_id_1.eq.${tenderId1},tender_id_2.eq.${tenderId2}),and(tender_id_1.eq.${tenderId2},tender_id_2.eq.${tenderId1})`
    );

  if (error) throw error;

  const map = new Map<string, string>();
  const exactOrderRows = (data || []).filter(r => r.tender_id_1 === tenderId1 && r.tender_id_2 === tenderId2);
  const reversedOrderRows = (data || []).filter(r => r.tender_id_1 === tenderId2 && r.tender_id_2 === tenderId1);

  for (const row of exactOrderRows) {
    const key = row.detail_category_key || `main__${row.cost_category_name}`;
    if (row.note) map.set(key, row.note);
  }
  for (const row of reversedOrderRows) {
    const key = row.detail_category_key || `main__${row.cost_category_name}`;
    if (row.note && !map.has(key)) map.set(key, row.note);
  }
  return map;
}

function getItemCategory(item: any) {
  const mainCategory = item.detail_cost_categories?.cost_categories?.name || 'Без категории';
  const detailName = item.detail_cost_categories?.name || 'Без детализации';
  const location = item.detail_cost_categories?.location || '';
  const detailKey = `${mainCategory}__${detailName}__${location}`;
  const detailCategoryId = item.detail_cost_category_id || null;
  return { mainCategory, detailName: location ? `${detailName} (${location})` : detailName, detailKey, detailCategoryId };
}

function addItemToRow(row: ComparisonRow, item: any, tenderIdx: number, costType: CostType) {
  const t = row.tenders[tenderIdx];
  if (!t) return;
  if (costType === 'commercial') {
    const mat = item.total_commercial_material_cost || 0;
    const work = item.total_commercial_work_cost || 0;
    t.materials += mat;
    t.works += work;
    t.total += mat + work;
  } else {
    const amount = item.total_amount || 0;
    if (MATERIAL_TYPES.includes(item.boq_item_type)) t.materials += amount;
    if (WORK_TYPES.includes(item.boq_item_type)) t.works += amount;
    t.total += amount;
  }
}

function buildHierarchy(
  itemsAll: any[][],
  costType: CostType,
  volumeMapsAll?: { detailMap: Map<string, number>; groupMap: Map<string, number> }[],
  notes?: NotesMap
): ComparisonRow[] {
  const numTenders = itemsAll.length;
  const detailRows = new Map<string, ComparisonRow>();
  const mainToDetails = new Map<string, Set<string>>();
  const detailKeyToCatId = new Map<string, string>();

  for (let idx = 0; idx < numTenders; idx++) {
    for (const item of itemsAll[idx]) {
      const { mainCategory, detailName, detailKey, detailCategoryId } = getItemCategory(item);

      if (!detailRows.has(detailKey)) {
        detailRows.set(detailKey, makeRow(detailKey, detailName, numTenders));
      }
      if (detailCategoryId && !detailKeyToCatId.has(detailKey)) {
        detailKeyToCatId.set(detailKey, detailCategoryId);
      }
      addItemToRow(detailRows.get(detailKey)!, item, idx, costType);

      if (!mainToDetails.has(mainCategory)) {
        mainToDetails.set(mainCategory, new Set());
      }
      mainToDetails.get(mainCategory)!.add(detailKey);
    }
  }

  if (volumeMapsAll) {
    for (const [detailKey, row] of detailRows) {
      const catId = detailKeyToCatId.get(detailKey);
      if (catId) {
        for (let idx = 0; idx < numTenders; idx++) {
          row.tenders[idx].volume = volumeMapsAll[idx]?.detailMap.get(catId) || 0;
        }
      }
    }
  }

  const result: ComparisonRow[] = [];
  const sortedCategories = [...mainToDetails.keys()].sort((a, b) => a.localeCompare(b, 'ru'));

  for (const mainCat of sortedCategories) {
    const detailKeys = mainToDetails.get(mainCat)!;
    const mainRow = makeRow(`main__${mainCat}`, mainCat, numTenders, true);
    const children: ComparisonRow[] = [];

    for (const dk of detailKeys) {
      const detail = detailRows.get(dk)!;
      calcPerUnit(detail);

      if (detail.tenders.every(t => t.total === 0)) continue;

      detail.mainCategoryName = mainCat;
      if (notes) detail.note = notes.get(dk) || null;

      for (let idx = 0; idx < numTenders; idx++) {
        mainRow.tenders[idx].materials += detail.tenders[idx].materials;
        mainRow.tenders[idx].works += detail.tenders[idx].works;
        mainRow.tenders[idx].total += detail.tenders[idx].total;
      }

      children.push(detail);
    }

    if (children.length === 0) continue;

    children.sort((a, b) => a.category.localeCompare(b.category, 'ru'));

    if (volumeMapsAll) {
      const groupKey = `category-${mainCat}`;
      for (let idx = 0; idx < numTenders; idx++) {
        mainRow.tenders[idx].volume = volumeMapsAll[idx]?.groupMap.get(groupKey) || 0;
      }
    }

    calcPerUnit(mainRow);
    mainRow.mainCategoryName = mainCat;
    if (notes) mainRow.note = notes.get(`main__${mainCat}`) || null;
    mainRow.children = children;
    result.push(mainRow);
  }

  return result;
}

export function useComparisonData() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenders, setSelectedTenders] = useState<(string | null)[]>([null, null]);
  const [tenderInfos, setTenderInfos] = useState<(Tender | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [comparisonData, setComparisonData] = useState<ComparisonRow[]>([]);
  const [costType, setCostType] = useState<CostType>('base');

  const [rawItemsAll, setRawItemsAll] = useState<any[][] | null>(null);
  const [volumeMapsAll, setVolumeMapsAll] = useState<{ detailMap: Map<string, number>; groupMap: Map<string, number> }[] | null>(null);
  const [notesMap, setNotesMap] = useState<NotesMap>(new Map());

  useEffect(() => {
    fetchTendersData();
  }, []);

  useEffect(() => {
    if (rawItemsAll) {
      const data = buildHierarchy(rawItemsAll, costType, volumeMapsAll || undefined, notesMap);
      setComparisonData(data);
    }
  }, [costType, rawItemsAll, volumeMapsAll, notesMap]);

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

  const loadComparisonData = async () => {
    const validTenders = selectedTenders.filter(Boolean) as string[];
    if (validTenders.length < 2) {
      message.warning('Выберите минимум два тендера для сравнения');
      return;
    }
    if (new Set(validTenders).size !== validTenders.length) {
      message.warning('Выберите разные тендеры для сравнения');
      return;
    }

    setLoading(true);
    try {
      const [tendersResult, itemsAll, volsAll] = await Promise.all([
        apiFetchTendersByIds(validTenders),
        Promise.all(validTenders.map(id => fetchBoqItems(id))),
        Promise.all(validTenders.map(id => fetchVolumes(id))),
      ]);

      const tendersById = new Map(tendersResult.map(t => [t.id, t]));
      setTenderInfos(validTenders.map(id => tendersById.get(id) ?? null));

      let loadedNotes: NotesMap = new Map();
      if (validTenders.length === 2) {
        loadedNotes = await fetchNotes(validTenders[0], validTenders[1]);
      }

      setRawItemsAll(itemsAll);
      setVolumeMapsAll(volsAll);
      setNotesMap(loadedNotes);

      const data = buildHierarchy(itemsAll, costType, volsAll, loadedNotes);
      setComparisonData(data);
      message.success('Данные успешно загружены');
    } catch (error) {
      message.error('Ошибка загрузки данных: ' + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const saveNote = useCallback(async (
    categoryName: string,
    detailKey: string | null,
    note: string
  ) => {
    const validTenders = selectedTenders.filter(Boolean) as string[];
    if (validTenders.length !== 2) return;
    const [tenderId1, tenderId2] = validTenders;

    try {
      const { error } = await supabase
        .from('comparison_notes')
        .upsert([
          { tender_id_1: tenderId1, tender_id_2: tenderId2, cost_category_name: categoryName, detail_category_key: detailKey, note },
          { tender_id_1: tenderId2, tender_id_2: tenderId1, cost_category_name: categoryName, detail_category_key: detailKey, note },
        ], { onConflict: 'tender_id_1,tender_id_2,cost_category_name,detail_category_key' });

      if (error) throw error;

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
    tenderTotals,
    saveNote,
  };
}
