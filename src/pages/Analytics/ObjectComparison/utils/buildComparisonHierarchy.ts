// Сборка дерева сравнения объектов: над-группа → категория → локализация →
// детализация, с удельными показателями на каждом уровне.
//
// Чистый модуль: ни запросов, ни React. Вынесен из useComparisonData.ts, который
// упёрся в лимит 600 строк.
import type {
  BoqItemForComparison,
  ComparisonRow,
  CostType,
  NotesMap,
  TenderCosts,
  VolumeMaps,
} from '../types';
import { VIS_SUPER_GROUP_NAME, VIS_SUPER_GROUP_KEY, isVisCategory } from '../../../../utils/costGroups';

const MATERIAL_TYPES = ['мат', 'суб-мат', 'мат-комп.'];
const WORK_TYPES = ['раб', 'суб-раб', 'раб-комп.'];

function makeEmptyTenderCosts(): TenderCosts {
  return {
    materials: 0, works: 0, total: 0,
    mat_per_unit: 0, work_per_unit: 0, total_per_unit: 0,
    volume: 0, total_per_sp: 0,
  };
}

export function makeRow(
  key: string,
  category: string,
  numTenders: number,
  isMain?: boolean,
): ComparisonRow {
  return {
    key,
    category,
    is_main_category: isMain,
    tenders: Array.from({ length: numTenders }, makeEmptyTenderCosts),
  };
}

/**
 * Удельные показатели строки.
 *
 * Два разных знаменателя. `*_per_unit` делит на объём самой категории
 * (монолит за м³, кладка за м²) — он свой у каждой строки. `total_per_sp` делит
 * на площадь по СП, одну на весь тендер, — этот показатель сопоставим между
 * категориями и между объектами.
 *
 * `areaSpAll` может не быть (площадь не заполнена) — тогда `total_per_sp`
 * остаётся нулевым, а не превращается в бесконечность.
 */
export function calcPerUnit(row: ComparisonRow, areaSpAll?: (number | null)[]): void {
  row.tenders.forEach((t, idx) => {
    t.mat_per_unit = t.volume > 0 ? t.materials / t.volume : 0;
    t.work_per_unit = t.volume > 0 ? t.works / t.volume : 0;
    t.total_per_unit = t.volume > 0 ? t.total / t.volume : 0;

    const areaSp = areaSpAll?.[idx] ?? 0;
    t.total_per_sp = areaSp > 0 ? t.total / areaSp : 0;
  });
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

function addItemToRow(
  row: ComparisonRow,
  item: BoqItemForComparison,
  tenderIdx: number,
  costType: CostType,
) {
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

export function buildHierarchy(
  itemsAll: BoqItemForComparison[][],
  costType: CostType,
  volumeMapsAll?: VolumeMaps[],
  notes?: NotesMap,
  areaSpAll?: (number | null)[],
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
      calcPerUnit(detail, areaSpAll);
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
          }
        }
        // Объём локализации — собственное значение группы из
        // construction_cost_volumes (group_key совпадает с ключом строки на
        // «Затратах на строительство»), а НЕ сумма объёмов детализаций: у
        // деталей одной локации объём обычно один и тот же (площадь ЛК,
        // кладовок, автостоянки), и суммирование занижало ₽/ед. в разы.
        if (volumeMapsAll) {
          const groupKey = `location-${mainCat}-${location}`;
          for (let idx = 0; idx < numTenders; idx++) {
            locRow.tenders[idx].volume = volumeMapsAll[idx]?.groupMap.get(groupKey) || 0;
          }
        }
        calcPerUnit(locRow, areaSpAll);
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

    calcPerUnit(mainRow, areaSpAll);
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
    calcPerUnit(superRow, areaSpAll);
    if (notes) superRow.note = notes.get(`main__${VIS_SUPER_GROUP_NAME}`) || null;

    const merged = result.filter((r) => !isVisCategory(r.category));
    merged.push(superRow);
    merged.sort((a, b) => a.category.localeCompare(b.category, 'ru'));
    return merged;
  }

  return result;
}
