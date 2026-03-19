import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import { supabase, type Tender } from '../../../../lib/supabase';
import type { CostType, ComparisonRow } from '../types';

const MATERIAL_TYPES = ['мат', 'суб-мат', 'мат-комп.'];
const WORK_TYPES = ['раб', 'суб-раб', 'раб-комп.'];

function makeRow(key: string, category: string, isMain?: boolean): ComparisonRow {
  return {
    key,
    category,
    is_main_category: isMain,
    tender1_materials: 0, tender1_works: 0, tender1_total: 0,
    tender2_materials: 0, tender2_works: 0, tender2_total: 0,
    diff_materials: 0, diff_works: 0, diff_total: 0,
    diff_materials_percent: 0, diff_works_percent: 0, diff_total_percent: 0,
    tender1_mat_per_unit: 0, tender1_work_per_unit: 0, tender1_total_per_unit: 0,
    tender2_mat_per_unit: 0, tender2_work_per_unit: 0, tender2_total_per_unit: 0,
    diff_mat_per_unit: 0, diff_work_per_unit: 0, diff_total_per_unit: 0,
    volume1: 0, volume2: 0,
  };
}

function calcPerUnit(row: ComparisonRow): void {
  row.tender1_mat_per_unit = row.volume1 > 0 ? row.tender1_materials / row.volume1 : 0;
  row.tender1_work_per_unit = row.volume1 > 0 ? row.tender1_works / row.volume1 : 0;
  row.tender1_total_per_unit = row.volume1 > 0 ? row.tender1_total / row.volume1 : 0;
  row.tender2_mat_per_unit = row.volume2 > 0 ? row.tender2_materials / row.volume2 : 0;
  row.tender2_work_per_unit = row.volume2 > 0 ? row.tender2_works / row.volume2 : 0;
  row.tender2_total_per_unit = row.volume2 > 0 ? row.tender2_total / row.volume2 : 0;
  row.diff_mat_per_unit = row.tender2_mat_per_unit - row.tender1_mat_per_unit;
  row.diff_work_per_unit = row.tender2_work_per_unit - row.tender1_work_per_unit;
  row.diff_total_per_unit = row.tender2_total_per_unit - row.tender1_total_per_unit;
}

function calcDiffs(row: ComparisonRow): ComparisonRow {
  row.diff_materials = row.tender2_materials - row.tender1_materials;
  row.diff_works = row.tender2_works - row.tender1_works;
  row.diff_total = row.tender2_total - row.tender1_total;
  row.diff_materials_percent = row.tender1_materials > 0
    ? (row.diff_materials / row.tender1_materials) * 100 : 0;
  row.diff_works_percent = row.tender1_works > 0
    ? (row.diff_works / row.tender1_works) * 100 : 0;
  row.diff_total_percent = row.tender1_total > 0
    ? (row.diff_total / row.tender1_total) * 100 : 0;
  calcPerUnit(row);
  return row;
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
  const exactOrderRows = (data || []).filter(
    (row) => row.tender_id_1 === tenderId1 && row.tender_id_2 === tenderId2
  );
  const reversedOrderRows = (data || []).filter(
    (row) => row.tender_id_1 === tenderId2 && row.tender_id_2 === tenderId1
  );

  for (const row of exactOrderRows) {
    // Main category: key = "main__CategoryName", detail: key = detailKey
    const key = row.detail_category_key || `main__${row.cost_category_name}`;
    if (row.note) map.set(key, row.note);
  }

  for (const row of reversedOrderRows) {
    const key = row.detail_category_key || `main__${row.cost_category_name}`;
    if (row.note && !map.has(key)) map.set(key, row.note);
  }

  return map;
}

interface CategoryAccum {
  mainCategory: string;
  detailName: string;
  detailKey: string;
  detailCategoryId: string | null;
}

function getItemCategory(item: any): CategoryAccum {
  const mainCategory = item.detail_cost_categories?.cost_categories?.name || 'Без категории';
  const detailName = item.detail_cost_categories?.name || 'Без детализации';
  const location = item.detail_cost_categories?.location || '';
  const detailKey = `${mainCategory}__${detailName}__${location}`;
  const detailCategoryId = item.detail_cost_category_id || null;
  return { mainCategory, detailName: location ? `${detailName} (${location})` : detailName, detailKey, detailCategoryId };
}

function addItemToRow(
  row: ComparisonRow,
  item: any,
  tenderNum: 1 | 2,
  costType: CostType
) {
  if (costType === 'commercial') {
    const mat = item.total_commercial_material_cost || 0;
    const work = item.total_commercial_work_cost || 0;
    if (tenderNum === 1) {
      row.tender1_materials += mat;
      row.tender1_works += work;
      row.tender1_total += mat + work;
    } else {
      row.tender2_materials += mat;
      row.tender2_works += work;
      row.tender2_total += mat + work;
    }
  } else {
    const amount = item.total_amount || 0;
    const isMat = MATERIAL_TYPES.includes(item.boq_item_type);
    const isWork = WORK_TYPES.includes(item.boq_item_type);
    if (tenderNum === 1) {
      if (isMat) row.tender1_materials += amount;
      if (isWork) row.tender1_works += amount;
      row.tender1_total += amount;
    } else {
      if (isMat) row.tender2_materials += amount;
      if (isWork) row.tender2_works += amount;
      row.tender2_total += amount;
    }
  }
}

interface VolumeMaps {
  detail1: Map<string, number>;
  group1: Map<string, number>;
  detail2: Map<string, number>;
  group2: Map<string, number>;
}

function buildHierarchy(
  items1: any[],
  items2: any[],
  costType: CostType,
  volumes?: VolumeMaps,
  notes?: NotesMap
): ComparisonRow[] {
  // detail rows keyed by detailKey
  const detailRows = new Map<string, ComparisonRow>();
  // main category -> set of detail keys
  const mainToDetails = new Map<string, Set<string>>();
  // detailKey -> detailCategoryId (for volume lookup)
  const detailKeyToCatId = new Map<string, string>();

  const processItem = (item: any, tenderNum: 1 | 2) => {
    const { mainCategory, detailName, detailKey, detailCategoryId } = getItemCategory(item);

    if (!detailRows.has(detailKey)) {
      detailRows.set(detailKey, makeRow(detailKey, detailName));
    }
    if (detailCategoryId && !detailKeyToCatId.has(detailKey)) {
      detailKeyToCatId.set(detailKey, detailCategoryId);
    }
    addItemToRow(detailRows.get(detailKey)!, item, tenderNum, costType);

    if (!mainToDetails.has(mainCategory)) {
      mainToDetails.set(mainCategory, new Set());
    }
    mainToDetails.get(mainCategory)!.add(detailKey);
  };

  items1.forEach(item => processItem(item, 1));
  items2.forEach(item => processItem(item, 2));

  // Assign volumes to detail rows
  if (volumes) {
    for (const [detailKey, row] of detailRows) {
      const catId = detailKeyToCatId.get(detailKey);
      if (catId) {
        row.volume1 = volumes.detail1.get(catId) || 0;
        row.volume2 = volumes.detail2.get(catId) || 0;
      }
    }
  }

  // Build main category rows with children
  const result: ComparisonRow[] = [];

  // Sort main categories alphabetically
  const sortedCategories = [...mainToDetails.keys()].sort((a, b) => a.localeCompare(b, 'ru'));

  for (const mainCat of sortedCategories) {
    const detailKeys = mainToDetails.get(mainCat)!;
    const mainRow = makeRow(`main__${mainCat}`, mainCat, true);
    const children: ComparisonRow[] = [];

    for (const dk of detailKeys) {
      const detail = calcDiffs(detailRows.get(dk)!);
      // Skip zero-cost details
      if (detail.tender1_total === 0 && detail.tender2_total === 0) continue;

      // Attach note and mainCategoryName
      detail.mainCategoryName = mainCat;
      if (notes) detail.note = notes.get(dk) || null;

      // Accumulate to main
      mainRow.tender1_materials += detail.tender1_materials;
      mainRow.tender1_works += detail.tender1_works;
      mainRow.tender1_total += detail.tender1_total;
      mainRow.tender2_materials += detail.tender2_materials;
      mainRow.tender2_works += detail.tender2_works;
      mainRow.tender2_total += detail.tender2_total;

      children.push(detail);
    }

    if (children.length === 0) continue;

    // Sort children alphabetically
    children.sort((a, b) => a.category.localeCompare(b.category, 'ru'));

    // Assign group volumes for main category
    if (volumes) {
      const groupKey = `category-${mainCat}`;
      mainRow.volume1 = volumes.group1.get(groupKey) || 0;
      mainRow.volume2 = volumes.group2.get(groupKey) || 0;
    }

    calcDiffs(mainRow);
    mainRow.mainCategoryName = mainCat;
    if (notes) mainRow.note = notes.get(`main__${mainCat}`) || null;
    mainRow.children = children;
    result.push(mainRow);
  }

  return result;
}

export function useComparisonData() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTender1, setSelectedTender1] = useState<string | null>(null);
  const [selectedTender2, setSelectedTender2] = useState<string | null>(null);
  const [tender1Info, setTender1Info] = useState<Tender | null>(null);
  const [tender2Info, setTender2Info] = useState<Tender | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparisonData, setComparisonData] = useState<ComparisonRow[]>([]);
  const [costType, setCostType] = useState<CostType>('base');

  // Cache raw items to avoid refetch on costType change
  const [rawItems1, setRawItems1] = useState<any[] | null>(null);
  const [rawItems2, setRawItems2] = useState<any[] | null>(null);
  const [volumeMaps, setVolumeMaps] = useState<VolumeMaps | null>(null);
  const [notesMap, setNotesMap] = useState<NotesMap>(new Map());

  useEffect(() => {
    fetchTenders();
  }, []);

  // Rebuild hierarchy when costType changes and we have cached data
  useEffect(() => {
    if (rawItems1 && rawItems2) {
      const data = buildHierarchy(rawItems1, rawItems2, costType, volumeMaps || undefined, notesMap);
      setComparisonData(data);
    }
  }, [costType, rawItems1, rawItems2, volumeMaps, notesMap]);

  const fetchTendersData = async () => {
    try {
      const { data, error } = await supabase
        .from('tenders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTenders(data || []);
    } catch (error: any) {
      message.error('Ошибка загрузки тендеров: ' + error.message);
    }
  };

  const fetchTenders = fetchTendersData;

  const loadComparisonData = async () => {
    if (!selectedTender1 || !selectedTender2) {
      message.warning('Выберите два тендера для сравнения');
      return;
    }
    if (selectedTender1 === selectedTender2) {
      message.warning('Выберите разные тендеры для сравнения');
      return;
    }

    setLoading(true);
    try {
      // Load tender info
      const [{ data: t1 }, { data: t2 }] = await Promise.all([
        supabase.from('tenders').select('*').eq('id', selectedTender1).single(),
        supabase.from('tenders').select('*').eq('id', selectedTender2).single(),
      ]);
      setTender1Info(t1);
      setTender2Info(t2);

      // Load BOQ items, volumes and notes for both tenders in parallel
      const [items1, items2, vol1, vol2, loadedNotes] = await Promise.all([
        fetchBoqItems(selectedTender1),
        fetchBoqItems(selectedTender2),
        fetchVolumes(selectedTender1),
        fetchVolumes(selectedTender2),
        fetchNotes(selectedTender1, selectedTender2),
      ]);

      const vols: VolumeMaps = {
        detail1: vol1.detailMap, group1: vol1.groupMap,
        detail2: vol2.detailMap, group2: vol2.groupMap,
      };

      // Cache raw items, volumes and notes
      setRawItems1(items1);
      setRawItems2(items2);
      setVolumeMaps(vols);
      setNotesMap(loadedNotes);

      // Build comparison with current costType
      const data = buildHierarchy(items1, items2, costType, vols, loadedNotes);
      setComparisonData(data);
      message.success('Данные успешно загружены');
    } catch (error: any) {
      message.error('Ошибка загрузки данных: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Save note to DB (upsert)
  const saveNote = useCallback(async (
    categoryName: string,
    detailKey: string | null,
    note: string
  ) => {
    if (!selectedTender1 || !selectedTender2) return;

    try {
      const rows: any[] = [
        {
          tender_id_1: selectedTender1,
          tender_id_2: selectedTender2,
          cost_category_name: categoryName,
          detail_category_key: detailKey,
          note,
        },
      ];

      if (selectedTender1 !== selectedTender2) {
        rows.push({
          tender_id_1: selectedTender2,
          tender_id_2: selectedTender1,
          cost_category_name: categoryName,
          detail_category_key: detailKey,
          note,
        });
      }

      const { error } = await supabase
        .from('comparison_notes')
        .upsert(rows, {
          onConflict: 'tender_id_1,tender_id_2,cost_category_name,detail_category_key',
        });

      if (error) throw error;

      // Update local cache
      const mapKey = detailKey || `main__${categoryName}`;
      setNotesMap(prev => {
        const next = new Map(prev);
        if (note) next.set(mapKey, note);
        else next.delete(mapKey);
        return next;
      });
    } catch (error: any) {
      message.error('Ошибка сохранения примечания: ' + error.message);
    }
  }, [selectedTender1, selectedTender2]);

  // Totals
  const totalStats = comparisonData.reduce(
    (acc, item) => ({
      tender1_total: acc.tender1_total + item.tender1_total,
      tender2_total: acc.tender2_total + item.tender2_total,
      diff_total: acc.diff_total + item.diff_total,
    }),
    { tender1_total: 0, tender2_total: 0, diff_total: 0 }
  );

  const diffPercent = totalStats.tender1_total > 0
    ? ((totalStats.diff_total / totalStats.tender1_total) * 100).toFixed(2)
    : '0';

  return {
    tenders,
    selectedTender1, setSelectedTender1,
    selectedTender2, setSelectedTender2,
    tender1Info, tender2Info,
    loading,
    comparisonData,
    costType, setCostType,
    loadComparisonData,
    totalStats, diffPercent,
    saveNote,
  };
}
