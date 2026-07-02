import { VIS_SUPER_GROUP_NAME, VIS_SUPER_GROUP_KEY, isVisCategory } from '../../../../utils/costGroups';
import type { listDetailCostCategoriesWithCategory } from '../../../../lib/api/costs';
import type { CostRow, CostSums } from '../types';
import { sortDetailRows } from './sortDetailRows';

type DetailCategoryWithJoined = Awaited<ReturnType<typeof listDetailCostCategoriesWithCategory>>[number];

export interface BuildCostRowsInput {
  categories: DetailCategoryWithJoined[] | null | undefined;
  costMap: Map<string, CostSums>;
  volumeMap: Map<string, number>;
  notesMap: Map<string, string>;
  groupVolumesMap: Map<string, number>;
  groupNotesMap: Map<string, string>;
  costType: 'base' | 'commercial';
}

/**
 * Строит дерево CostRow (над-группа ВИС → категория → локализация → деталь)
 * из детальных категорий и агрегированных затрат, фильтрует нулевые затраты
 * и восстанавливает сохранённые объёмы групп.
 * Перенесено из fetchConstructionCosts без изменений логики.
 */
export const buildCostRows = (input: BuildCostRowsInput): CostRow[] => {
  const { categories, costMap, volumeMap, notesMap, groupVolumesMap, groupNotesMap, costType } = input;

  // Группируем детальные категории по категориям и локализациям
  const categoryMap = new Map<string, CostRow>();
  const categoryLocations = new Map<string, Set<string>>(); // Для подсчета локализаций

  // Первый проход: собираем детальные строки и определяем структуру
  const detailRowsByCategory = new Map<string, CostRow[]>();

  (categories || []).forEach((cat) => {
    const volume = volumeMap.get(cat.id) || 0;
    const costs = costMap.get(cat.id) || { materials: 0, works: 0, subMaterials: 0, subWorks: 0, materialsComp: 0, worksComp: 0 };
    const totalCost = costs.materials + costs.works + costs.subMaterials + costs.subWorks + costs.materialsComp + costs.worksComp;
    const costPerUnit = volume > 0 ? totalCost / volume : 0;

    const cc = Array.isArray(cat.cost_categories) ? cat.cost_categories[0] : cat.cost_categories;
    const categoryName = cc?.name || '';
    const location = cat.location || '';

    const detailRow: CostRow = {
      key: cat.id,
      detail_cost_category_id: cat.id,
      cost_category_name: categoryName,
      detail_category_name: cat.name,
      location_name: location,
      volume,
      unit: cat.unit,
      materials_cost: costs.materials,
      works_cost: costs.works,
      sub_materials_cost: costs.subMaterials,
      sub_works_cost: costs.subWorks,
      materials_comp_cost: costs.materialsComp,
      works_comp_cost: costs.worksComp,
      total_cost: totalCost,
      cost_per_unit: costPerUnit,
      order_num: cat.order_num ?? undefined,
      notes: notesMap.get(cat.id),
    };

    // Собираем строки по категориям
    if (!detailRowsByCategory.has(categoryName)) {
      detailRowsByCategory.set(categoryName, []);
    }
    detailRowsByCategory.get(categoryName)!.push(detailRow);

    // Собираем уникальные локализации для каждой категории
    if (!categoryLocations.has(categoryName)) {
      categoryLocations.set(categoryName, new Set());
    }
    if (location) {
      categoryLocations.get(categoryName)!.add(location);
    }
  });

  // Второй проход: строим иерархию с учетом локализаций
  for (const [categoryName, detailRows] of detailRowsByCategory.entries()) {
    const locations = categoryLocations.get(categoryName) || new Set();
    const hasMultipleLocations = locations.size > 1;

    // Создаем категорию
    const categoryKey = `category-${categoryName}`;
    const categoryRow: CostRow = {
      key: categoryKey,
      cost_category_name: categoryName,
      detail_category_name: '',
      location_name: '',
      volume: 0,
      unit: '',
      materials_cost: 0,
      works_cost: 0,
      sub_materials_cost: 0,
      sub_works_cost: 0,
      materials_comp_cost: 0,
      works_comp_cost: 0,
      total_cost: 0,
      cost_per_unit: 0,
      is_category: true,
      children: [],
      order_num: detailRows[0]?.order_num || 0,
      notes: groupNotesMap.get(categoryKey),
    };

    if (hasMultipleLocations) {
      // Группируем по локализациям
      const locationGroups = new Map<string, CostRow[]>();

      detailRows.forEach(row => {
        const location = row.location_name || '';
        if (!locationGroups.has(location)) {
          locationGroups.set(location, []);
        }
        locationGroups.get(location)!.push(row);
      });

      // Создаем строки локализаций
      for (const [location, rows] of locationGroups.entries()) {
        const sortedRows = sortDetailRows(rows, categoryName, location);
        const locationKey = `location-${categoryName}-${location}`;

        const locationRow: CostRow = {
          key: locationKey,
          cost_category_name: categoryName,
          detail_category_name: '',
          location_name: location,
          volume: 0,
          unit: '',
          materials_cost: 0,
          works_cost: 0,
          sub_materials_cost: 0,
          sub_works_cost: 0,
          materials_comp_cost: 0,
          works_comp_cost: 0,
          total_cost: 0,
          cost_per_unit: 0,
          is_location: true,
          children: sortedRows,
          order_num: sortedRows[0]?.order_num || 0,
          notes: groupNotesMap.get(locationKey),
        };

        // Суммируем затраты для локализации
        sortedRows.forEach(row => {
          locationRow.materials_cost += row.materials_cost;
          locationRow.works_cost += row.works_cost;
          locationRow.sub_materials_cost += row.sub_materials_cost;
          locationRow.sub_works_cost += row.sub_works_cost;
          locationRow.materials_comp_cost += row.materials_comp_cost;
          locationRow.works_comp_cost += row.works_comp_cost;
          locationRow.total_cost += row.total_cost;
        });

        categoryRow.children!.push(locationRow);

        // Суммируем в категорию
        categoryRow.materials_cost += locationRow.materials_cost;
        categoryRow.works_cost += locationRow.works_cost;
        categoryRow.sub_materials_cost += locationRow.sub_materials_cost;
        categoryRow.sub_works_cost += locationRow.sub_works_cost;
        categoryRow.materials_comp_cost += locationRow.materials_comp_cost;
        categoryRow.works_comp_cost += locationRow.works_comp_cost;
        categoryRow.total_cost += locationRow.total_cost;
      }
    } else {
      // Одна локализация или без локализации - добавляем напрямую
      const sortedRows = sortDetailRows(detailRows, categoryName);
      categoryRow.children = sortedRows;

      // Суммируем в категорию
      sortedRows.forEach(row => {
        categoryRow.materials_cost += row.materials_cost;
        categoryRow.works_cost += row.works_cost;
        categoryRow.sub_materials_cost += row.sub_materials_cost;
        categoryRow.sub_works_cost += row.sub_works_cost;
        categoryRow.materials_comp_cost += row.materials_comp_cost;
        categoryRow.works_comp_cost += row.works_comp_cost;
        categoryRow.total_cost += row.total_cost;
      });
    }

    categoryMap.set(categoryName, categoryRow);
  }

  // Добавляем категорию "Не распределено" если есть items без detail_cost_category_id
  if (costMap.has('uncategorized')) {
    const uncategorizedCosts = costMap.get('uncategorized')!;
    const uncategorizedTotal = uncategorizedCosts.materials + uncategorizedCosts.works +
      uncategorizedCosts.subMaterials + uncategorizedCosts.subWorks +
      uncategorizedCosts.materialsComp + uncategorizedCosts.worksComp;

    if (uncategorizedTotal > 0) {
      categoryMap.set('Не распределено', {
        key: 'category-uncategorized',
        cost_category_name: 'Не распределено',
        detail_category_name: '',
        location_name: '',
        volume: 0,
        unit: '',
        materials_cost: uncategorizedCosts.materials,
        works_cost: uncategorizedCosts.works,
        sub_materials_cost: uncategorizedCosts.subMaterials,
        sub_works_cost: uncategorizedCosts.subWorks,
        materials_comp_cost: uncategorizedCosts.materialsComp,
        works_comp_cost: uncategorizedCosts.worksComp,
        total_cost: uncategorizedTotal,
        cost_per_unit: 0,
        is_category: true,
        children: [{
          key: 'uncategorized-detail',
          cost_category_name: 'Не распределено',
          detail_category_name: 'Элементы без затрат',
          location_name: '-',
          volume: 0,
          unit: '-',
          materials_cost: uncategorizedCosts.materials,
          works_cost: uncategorizedCosts.works,
          sub_materials_cost: uncategorizedCosts.subMaterials,
          sub_works_cost: uncategorizedCosts.subWorks,
          materials_comp_cost: uncategorizedCosts.materialsComp,
          works_comp_cost: uncategorizedCosts.worksComp,
          total_cost: uncategorizedTotal,
          cost_per_unit: 0,
        }],
        order_num: 999999, // В конец списка
      });
    }
  }

  let rows: CostRow[] = Array.from(categoryMap.values()).sort((a, b) =>
    (a.order_num || 0) - (b.order_num || 0)
  );

  // Над-группа «ВНУТРЕННИЕ ИНЖЕНЕРНЫЕ СИСТЕМЫ»: оборачиваем отдельные
  // ВИС-категории в одну синтетическую строку. is_category=true — чтобы
  // переиспользовать ввод объёма/примечания, расчёт ₽/ед. и суммы. Общий
  // group_key со страницей «Сравнение затрат» (см. utils/costGroups).
  const visCategories = rows.filter(
    (r) => r.is_category && isVisCategory(r.cost_category_name),
  );
  if (visCategories.length > 0) {
    const visChildren = [...visCategories].sort(
      (a, b) => (a.order_num || 0) - (b.order_num || 0),
    ).map((c) => ({ ...c, is_vis_subcategory: true }));
    const superGroup: CostRow = {
      key: VIS_SUPER_GROUP_KEY,
      cost_category_name: VIS_SUPER_GROUP_NAME,
      detail_category_name: '',
      location_name: '',
      volume: 0,
      unit: '',
      materials_cost: 0,
      works_cost: 0,
      sub_materials_cost: 0,
      sub_works_cost: 0,
      materials_comp_cost: 0,
      works_comp_cost: 0,
      total_cost: 0,
      cost_per_unit: 0,
      is_category: true,
      is_super_group: true,
      children: visChildren,
      order_num: Math.min(...visChildren.map((c) => c.order_num || 0)),
      notes: groupNotesMap.get(VIS_SUPER_GROUP_KEY),
    };
    visChildren.forEach((child) => {
      superGroup.materials_cost += child.materials_cost;
      superGroup.works_cost += child.works_cost;
      superGroup.sub_materials_cost += child.sub_materials_cost;
      superGroup.sub_works_cost += child.sub_works_cost;
      superGroup.materials_comp_cost += child.materials_comp_cost;
      superGroup.works_comp_cost += child.works_comp_cost;
      superGroup.total_cost += child.total_cost;
    });
    rows = rows.filter((r) => !visCategories.includes(r));
    rows.push(superGroup);
    rows.sort((a, b) => (a.order_num || 0) - (b.order_num || 0));
  }

  // Рекурсивная фильтрация нулевых затрат на всех уровнях
  const filterZeroCosts = (items: CostRow[]): CostRow[] => {
    return items
      .map(item => {
        if (item.children) {
          const filteredChildren = filterZeroCosts(item.children);
          return {
            ...item,
            children: filteredChildren.length > 0 ? filteredChildren : undefined
          };
        }
        return item;
      })
      .filter(item => {
        // Для категорий и локализаций - проверяем наличие children
        if (item.is_category || item.is_location) {
          return item.children && item.children.length > 0;
        }
        // Для деталей - проверяем total_cost
        return item.total_cost > 0;
      });
  };

  rows = filterZeroCosts(rows);

  // Восстанавливаем объемы групп из загруженных значений
  const restoreGroupVolumes = (items: CostRow[], volumesMap: Map<string, number>): CostRow[] => {
    return items.map(item => {
      if ((item.is_category || item.is_location) && volumesMap.has(item.key)) {
        const restoredVolume = volumesMap.get(item.key)!;
        console.log('Restoring volume for group:', item.key, 'volume:', restoredVolume);
        return {
          ...item,
          volume: restoredVolume,
          children: item.children ? restoreGroupVolumes(item.children, volumesMap) : undefined
        };
      }
      if (item.children) {
        return { ...item, children: restoreGroupVolumes(item.children, volumesMap) };
      }
      return item;
    });
  };

  rows = restoreGroupVolumes(rows, groupVolumesMap);
  console.log('Rows after restoring group volumes:', rows.length);

  // Логирование итоговых сумм
  const totalSums = rows.reduce((sum, row) => ({
    materials: sum.materials + row.materials_cost,
    works: sum.works + row.works_cost,
    subMaterials: sum.subMaterials + row.sub_materials_cost,
    subWorks: sum.subWorks + row.sub_works_cost,
    materialsComp: sum.materialsComp + row.materials_comp_cost,
    worksComp: sum.worksComp + row.works_comp_cost,
    total: sum.total + row.total_cost
  }), { materials: 0, works: 0, subMaterials: 0, subWorks: 0, materialsComp: 0, worksComp: 0, total: 0 });

  console.log('\n=== ИТОГОВЫЕ СУММЫ COSTS PAGE (costType=' + costType + ') ===');
  console.log('Материалы:', totalSums.materials.toLocaleString('ru-RU'));
  console.log('Работы:', totalSums.works.toLocaleString('ru-RU'));
  console.log('Суб-материалы:', totalSums.subMaterials.toLocaleString('ru-RU'));
  console.log('Суб-работы:', totalSums.subWorks.toLocaleString('ru-RU'));
  console.log('Комп. материалы:', totalSums.materialsComp.toLocaleString('ru-RU'));
  console.log('Комп. работы:', totalSums.worksComp.toLocaleString('ru-RU'));
  console.log('ИТОГО:', totalSums.total.toLocaleString('ru-RU'));
  console.log('Ожидается: 5,613,631,822');

  return rows;
};
