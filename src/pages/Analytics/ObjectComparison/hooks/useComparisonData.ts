import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import type { Tender } from '../../../../lib/types';
import { fetchTenders as apiFetchTenders, fetchTendersByIds as apiFetchTendersByIds } from '../../../../lib/api/tenders';
import { listAllBoqItemsForTender } from '../../../../lib/api/fi';
import { listDetailCostCategoriesWithCategory } from '../../../../lib/api/costs';
import { apiFetch } from '../../../../lib/api/client';
import {
  loadLiveCommercialCalculationContext,
  calculateLiveCommercialAmounts,
  resetLiveCommercialCalculationCache,
} from '../../../../utils/boq/liveCommercialCalculation';
import type { CostType, ComparisonRow, TenderCosts } from '../types';
import { getErrorMessage } from '../../../../utils/errors';
import { VIS_SUPER_GROUP_NAME, VIS_SUPER_GROUP_KEY, isVisCategory } from '../../../../utils/costGroups';

interface BoqItemForComparison {
  total_amount: number | null;
  boq_item_type: string | null;
  total_commercial_material_cost: number | null;
  total_commercial_work_cost: number | null;
  detail_cost_category_id: string | null;
  detail_cost_categories: {
    name: string | null;
    location: string | null;
    cost_categories: { name: string | null } | null;
  } | null;
  client_positions: { tender_id: string } | null;
}

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

interface CostVolumeRow {
  detail_cost_category_id: string | null;
  volume: number | null;
  group_key: string | null;
}

async function fetchVolumes(tenderId: string): Promise<{ detailMap: Map<string, number>; groupMap: Map<string, number> }> {
  const res = await apiFetch<{ data: CostVolumeRow[] }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/cost-volumes`,
  );

  const detailMap = new Map<string, number>();
  const groupMap = new Map<string, number>();
  for (const v of (res.data || [])) {
    if (v.detail_cost_category_id) {
      detailMap.set(v.detail_cost_category_id, v.volume || 0);
    } else if (v.group_key) {
      groupMap.set(v.group_key, v.volume || 0);
    }
  }
  return { detailMap, groupMap };
}

// ВНИМАНИЕ: вызывать ПОСЛЕДОВАТЕЛЬНО по тендерам (не через Promise.all). Кэш
// коэффициентов в calculateBoqItemCost — module-level и ключуется только по
// типу/исключению/НДС (без tenderId), поэтому конкурентный расчёт тендеров с
// разными тактиками привёл бы к загрязнению. Сброс в начале каждого тендера +
// последовательный вызов гарантируют корректность.
async function fetchBoqItems(tenderId: string): Promise<BoqItemForComparison[]> {
  // Go BFF: boq-items-flat для тендера + справочник детальных категорий
  // (с присоединённой родительской категорией) + контекст для live-расчёта
  // коммерческих стоимостей. Соединяем по detail_cost_category_id. Сохраняем
  // семантику прежних !inner-джойнов: берём только элементы с
  // detail_cost_category_id, который резолвится.
  const [items, detailCats, calcContext] = await Promise.all([
    listAllBoqItemsForTender(tenderId),
    listDetailCostCategoriesWithCategory(),
    loadLiveCommercialCalculationContext(tenderId),
  ]);

  const catMap = new Map<
    string,
    { name: string | null; location: string | null; cost_categories: { name: string | null } | null }
  >();
  for (const dc of detailCats) {
    catMap.set(dc.id, {
      name: dc.name ?? null,
      location: (dc as { location?: string | null }).location ?? null,
      cost_categories: dc.cost_categories ? { name: dc.cost_categories.name ?? null } : null,
    });
  }

  // Сбрасываем кэш коэффициентов перед расчётом этого тендера.
  resetLiveCommercialCalculationCache();

  const out: BoqItemForComparison[] = [];
  for (const i of items) {
    const detailId = i.detail_cost_category_id ?? null;
    if (!detailId) continue;
    const cat = catMap.get(detailId);
    if (!cat) continue; // эквивалент detail_cost_categories!inner
    // Коммерческие стоимости считаем на лету по тактике тендера (как на странице
    // «Финансовые показатели»), не полагаясь на материализованные
    // total_commercial_* — они могут отставать до серверного авто-пересчёта.
    const live = calculateLiveCommercialAmounts(
      i as unknown as Parameters<typeof calculateLiveCommercialAmounts>[0],
      calcContext,
    );
    out.push({
      total_amount: i.total_amount ?? null,
      boq_item_type: i.boq_item_type ?? null,
      total_commercial_material_cost: live.materialCost,
      total_commercial_work_cost: live.workCost,
      detail_cost_category_id: detailId,
      detail_cost_categories: cat,
      client_positions: { tender_id: tenderId },
    });
  }
  return out;
}

type NotesMap = Map<string, string>;

interface ComparisonNoteRow {
  tender_id_1: string;
  tender_id_2: string;
  cost_category_name: string;
  detail_category_key: string | null;
  note: string;
}

async function fetchNotes(tenderId1: string, tenderId2: string): Promise<NotesMap> {
  const res = await apiFetch<{ data: ComparisonNoteRow[] }>(
    `/api/v1/comparison-notes?tender_id_1=${encodeURIComponent(tenderId1)}&tender_id_2=${encodeURIComponent(tenderId2)}`,
  );
  const data = res.data || [];

  const map = new Map<string, string>();
  const exactOrderRows = data.filter(r => r.tender_id_1 === tenderId1 && r.tender_id_2 === tenderId2);
  const reversedOrderRows = data.filter(r => r.tender_id_1 === tenderId2 && r.tender_id_2 === tenderId1);

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

// Для этих категорий добавляем промежуточный уровень «локализация» между
// категорией и детализацией — по аналогии с «Затраты на строительство».
// Совпадение по подстроке, чтобы ловить варианты «Отделочные работы»,
// «Двери, люки, ворота» и т.п.
function categoryHasLocationGrouping(categoryName: string): boolean {
  const lower = categoryName.toLowerCase();
  return lower.includes('отделочн') || lower.includes('двер');
}

function getItemCategory(item: BoqItemForComparison) {
  const mainCategory = item.detail_cost_categories?.cost_categories?.name || 'Без категории';
  const rawDetailName = item.detail_cost_categories?.name || 'Без детализации';
  const location = item.detail_cost_categories?.location || '';
  const detailKey = `${mainCategory}__${rawDetailName}__${location}`;
  const detailCategoryId = item.detail_cost_category_id || null;
  return { mainCategory, rawDetailName, location, detailKey, detailCategoryId };
}

function addItemToRow(row: ComparisonRow, item: BoqItemForComparison, tenderIdx: number, costType: CostType) {
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
    const itemType = item.boq_item_type ?? '';
    if (MATERIAL_TYPES.includes(itemType)) t.materials += amount;
    if (WORK_TYPES.includes(itemType)) t.works += amount;
    t.total += amount;
  }
}

function buildHierarchy(
  itemsAll: BoqItemForComparison[][],
  costType: CostType,
  volumeMapsAll?: { detailMap: Map<string, number>; groupMap: Map<string, number> }[],
  notes?: NotesMap
): ComparisonRow[] {
  const numTenders = itemsAll.length;
  const detailRows = new Map<string, ComparisonRow>();
  const mainToDetails = new Map<string, Set<string>>();
  const detailKeyToCatId = new Map<string, string>();
  // Запоминаем связку detailKey → (rawDetailName, location) для второго прохода,
  // где решаем: вставлять уровень локализации или нет.
  const detailKeyMeta = new Map<string, { rawName: string; location: string }>();
  // Уникальные локализации по категории — если ≥2, добавляем уровень «локализация».
  const locationsByCategory = new Map<string, Set<string>>();

  for (let idx = 0; idx < numTenders; idx++) {
    for (const item of itemsAll[idx]) {
      const { mainCategory, rawDetailName, location, detailKey, detailCategoryId } = getItemCategory(item);

      if (!detailRows.has(detailKey)) {
        // Имя детали для таблицы — пока как есть; location допишем ниже, если
        // не будет отдельного уровня локализации.
        detailRows.set(detailKey, makeRow(detailKey, rawDetailName, numTenders));
        detailKeyMeta.set(detailKey, { rawName: rawDetailName, location });
      }
      if (detailCategoryId && !detailKeyToCatId.has(detailKey)) {
        detailKeyToCatId.set(detailKey, detailCategoryId);
      }
      addItemToRow(detailRows.get(detailKey)!, item, idx, costType);

      if (!mainToDetails.has(mainCategory)) {
        mainToDetails.set(mainCategory, new Set());
      }
      mainToDetails.get(mainCategory)!.add(detailKey);

      if (!locationsByCategory.has(mainCategory)) {
        locationsByCategory.set(mainCategory, new Set());
      }
      locationsByCategory.get(mainCategory)!.add(location);
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
    const locations = locationsByCategory.get(mainCat) ?? new Set<string>();
    // Вставляем уровень локализации только если категория в whitelist'е и
    // в ней реально ≥2 разных локализаций (включая возможный пустой '').
    const wantLocationLevel = categoryHasLocationGrouping(mainCat) && locations.size >= 2;

    const mainRow = makeRow(`main__${mainCat}`, mainCat, numTenders, true);

    // Сначала собираем непустые detail-строки с их мета (location).
    const activeDetails: { row: ComparisonRow; location: string }[] = [];
    for (const dk of detailKeys) {
      const detail = detailRows.get(dk)!;
      calcPerUnit(detail);
      if (detail.tenders.every(t => t.total === 0)) continue;

      detail.mainCategoryName = mainCat;
      if (notes) detail.note = notes.get(dk) || null;

      const meta = detailKeyMeta.get(dk) ?? { rawName: detail.category, location: '' };
      // Если уровень локализации НЕ добавляем — по-старому дописываем "(location)"
      // к имени детали, иначе локализация уйдёт в имя родительской строки.
      if (!wantLocationLevel && meta.location) {
        detail.category = `${meta.rawName} (${meta.location})`;
      } else {
        detail.category = meta.rawName;
      }

      for (let idx = 0; idx < numTenders; idx++) {
        mainRow.tenders[idx].materials += detail.tenders[idx].materials;
        mainRow.tenders[idx].works += detail.tenders[idx].works;
        mainRow.tenders[idx].total += detail.tenders[idx].total;
      }

      activeDetails.push({ row: detail, location: meta.location });
    }

    if (activeDetails.length === 0) continue;

    let children: ComparisonRow[];
    if (wantLocationLevel) {
      // Группируем по локализации.
      const byLocation = new Map<string, ComparisonRow[]>();
      for (const { row, location } of activeDetails) {
        const key = location || '_no_location';
        const bucket = byLocation.get(key);
        if (bucket) bucket.push(row);
        else byLocation.set(key, [row]);
      }

      const locationRows: ComparisonRow[] = [];
      for (const [locKey, group] of byLocation) {
        const location = locKey === '_no_location' ? '' : locKey;
        const locRow = makeRow(
          `loc__${mainCat}__${locKey}`,
          location || 'Без локации',
          numTenders,
        );
        locRow.is_location = true;
        locRow.mainCategoryName = mainCat;
        if (notes) locRow.note = notes.get(locRow.key) || null;
        for (const g of group) {
          for (let idx = 0; idx < numTenders; idx++) {
            locRow.tenders[idx].materials += g.tenders[idx].materials;
            locRow.tenders[idx].works += g.tenders[idx].works;
            locRow.tenders[idx].total += g.tenders[idx].total;
            locRow.tenders[idx].volume += g.tenders[idx].volume;
          }
        }
        calcPerUnit(locRow);
        group.sort((a, b) => a.category.localeCompare(b.category, 'ru'));
        locRow.children = group;
        locationRows.push(locRow);
      }
      locationRows.sort((a, b) => a.category.localeCompare(b.category, 'ru'));
      children = locationRows;
    } else {
      children = activeDetails.map(({ row }) => row);
      children.sort((a, b) => a.category.localeCompare(b.category, 'ru'));
    }

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

  // Над-группа «ВНУТРЕННИЕ ИНЖЕНЕРНЫЕ СИСТЕМЫ»: оборачиваем отдельные
  // ВИС-категории (ВИС / …) в одну строку. is_main_category=true — чтобы
  // переиспользовать жирный стиль, класс строки и сохранение примечания.
  // Объём берём из construction_cost_volumes по общему group_key (read-only,
  // введён на «Затратах на строительство») — см. utils/costGroups.
  const visRows = result.filter((r) => isVisCategory(r.category));
  if (visRows.length > 0) {
    const superRow = makeRow(`main__${VIS_SUPER_GROUP_NAME}`, VIS_SUPER_GROUP_NAME, numTenders, true);
    superRow.is_super_group = true;
    superRow.mainCategoryName = VIS_SUPER_GROUP_NAME;
    superRow.children = visRows;
    for (const child of visRows) {
      for (let idx = 0; idx < numTenders; idx++) {
        superRow.tenders[idx].materials += child.tenders[idx].materials;
        superRow.tenders[idx].works += child.tenders[idx].works;
        superRow.tenders[idx].total += child.tenders[idx].total;
      }
    }
    if (volumeMapsAll) {
      for (let idx = 0; idx < numTenders; idx++) {
        superRow.tenders[idx].volume = volumeMapsAll[idx]?.groupMap.get(VIS_SUPER_GROUP_KEY) || 0;
      }
    }
    calcPerUnit(superRow);
    if (notes) superRow.note = notes.get(`main__${VIS_SUPER_GROUP_NAME}`) || null;

    const merged = result.filter((r) => !isVisCategory(r.category));
    merged.push(superRow);
    merged.sort((a, b) => a.category.localeCompare(b.category, 'ru'));
    return merged;
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

  const [rawItemsAll, setRawItemsAll] = useState<BoqItemForComparison[][] | null>(null);
  const [volumeMapsAll, setVolumeMapsAll] = useState<{ detailMap: Map<string, number>; groupMap: Map<string, number> }[] | null>(null);
  const [notesMap, setNotesMap] = useState<NotesMap>(new Map());
  // Тендеры, по которым реально загружено сравнение (на них вешаем realtime).
  const [loadedTenderIds, setLoadedTenderIds] = useState<string[]>([]);

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

  // Общий загрузчик. silent=true — для realtime-обновления (без спиннера и
  // тостов). Пересборка comparisonData выполняется эффектом по rawItemsAll.
  const runLoad = useCallback(async (validTenders: string[], silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      const tendersResult = await apiFetchTendersByIds(validTenders);

      // Последовательно по тендерам — общий module-level кэш коэффициентов в
      // calculateBoqItemCost не допускает конкурентного расчёта (см. fetchBoqItems).
      const itemsAll: BoqItemForComparison[][] = [];
      for (const id of validTenders) {
        itemsAll.push(await fetchBoqItems(id));
      }
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
  };
}
