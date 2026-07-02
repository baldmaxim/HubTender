import type { CostRow } from '../types';
import type { OppositeCosts } from './fetchOppositeCosts';
import { sortDetailRows } from './sortDetailRows';

// Типы строк для стилизации
export type RowType = 'header' | 'subheader' | 'supergroup' | 'category' | 'location' | 'detail';

export interface ExportDataWithTypes {
  data: (string | number)[][];
  rowTypes: RowType[];
}

/**
 * Формирует данные для экспорта в Excel
 */
export function buildExportData(
  filteredData: CostRow[],
  oppositeCostMap: Map<string, OppositeCosts>,
  areaSp: number
): ExportDataWithTypes {
  const exportData: (string | number)[][] = [];
  const rowTypes: RowType[] = [];

  // Заголовки
  exportData.push([
    'Затрата тендера',
    'Локализация',
    'Объем',
    'Ед. изм.',
    'Прямые Затраты',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'Коммерческие Затраты',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  rowTypes.push('header');

  exportData.push([
    '',
    '',
    '',
    '',
    'Работы',
    'Материалы',
    'Работы суб.',
    'Материал суб.',
    'Раб-комп.',
    'Мат-комп.',
    'Итого работ',
    'Итого материалы',
    'Итого',
    'Итого работ за ед.',
    'Итого материалы за ед.',
    'Итого за единицу',
    'Работы',
    'Материалы',
    'Работы суб.',
    'Материал суб.',
    'Раб-комп.',
    'Мат-комп.',
    'Итого работ',
    'Итого материалы',
    'Итого',
    'Итого работ за ед.',
    'Итого материалы за ед.',
    'Итого за единицу',
    'Итого за единицу общей площади',
  ]);
  rowTypes.push('subheader');

  // Разворачиваем над-группу «ВНУТРЕННИЕ ИНЖЕНЕРНЫЕ СИСТЕМЫ» в плоский список:
  // строка над-группы + её дочерние категории (нумерация категорий сквозная).
  const emitList: { type: 'supergroup' | 'category'; row: CostRow }[] = [];
  filteredData.forEach((topRow) => {
    if (topRow.is_super_group && topRow.total_cost > 0) {
      emitList.push({ type: 'supergroup', row: topRow });
      (topRow.children || []).forEach((child) => {
        if (child.is_category && child.total_cost > 0) {
          emitList.push({ type: 'category', row: child });
        }
      });
    } else if (topRow.is_category && !topRow.is_super_group && topRow.total_cost > 0) {
      emitList.push({ type: 'category', row: topRow });
    }
  });

  // Опп. затраты по всему поддереву строки (для итоговой строки над-группы).
  const sumOppositeSubtree = (r: CostRow): OppositeCosts => {
    const acc: OppositeCosts = { materials: 0, works: 0, subMaterials: 0, subWorks: 0, materialsComp: 0, worksComp: 0 };
    const walk = (node: CostRow) => {
      if (node.detail_cost_category_id) {
        const o = oppositeCostMap.get(node.detail_cost_category_id);
        if (o) {
          acc.materials += o.materials;
          acc.works += o.works;
          acc.subMaterials += o.subMaterials;
          acc.subWorks += o.subWorks;
          acc.materialsComp += o.materialsComp;
          acc.worksComp += o.worksComp;
        }
      }
      node.children?.forEach(walk);
    };
    walk(r);
    return acc;
  };

  let categoryIndex = 1;

  emitList.forEach(({ type, row }) => {
    if (type === 'supergroup') {
      const superVolume = row.volume || 0;
      const superWorks = row.works_cost + row.sub_works_cost + row.works_comp_cost;
      const superMaterials = row.materials_cost + row.sub_materials_cost + row.materials_comp_cost;
      const opp = sumOppositeSubtree(row);
      const oppWorks = opp.works + opp.subWorks + opp.worksComp;
      const oppMaterials = opp.materials + opp.subMaterials + opp.materialsComp;
      const oppTotal = oppWorks + oppMaterials;
      exportData.push([
        row.cost_category_name.toUpperCase(),
        '',
        superVolume,
        'м2',
        row.works_cost,
        row.materials_cost,
        row.sub_works_cost,
        row.sub_materials_cost,
        row.works_comp_cost,
        row.materials_comp_cost,
        superWorks,
        superMaterials,
        row.total_cost,
        superVolume ? superWorks / superVolume : '',
        superVolume ? superMaterials / superVolume : '',
        superVolume ? row.total_cost / superVolume : '',
        opp.works,
        opp.materials,
        opp.subWorks,
        opp.subMaterials,
        opp.worksComp,
        opp.materialsComp,
        oppWorks,
        oppMaterials,
        oppTotal,
        superVolume ? oppWorks / superVolume : '',
        superVolume ? oppMaterials / superVolume : '',
        superVolume ? oppTotal / superVolume : '',
        areaSp ? oppTotal / areaSp : '',
      ]);
      rowTypes.push('supergroup');
      return;
    }
    const category = row;
    if (category.is_category && category.total_cost > 0) {
      const catNum = String(categoryIndex).padStart(2, '0');
      const categoryTotalVolume = category.volume || 0;
      const categoryTotalWorks =
        category.works_cost + category.sub_works_cost + category.works_comp_cost;
      const categoryTotalMaterials =
        category.materials_cost +
        category.sub_materials_cost +
        category.materials_comp_cost;

      // Суммируем противоположные затраты для категории
      let oppCatWorks = 0,
        oppCatMaterials = 0,
        oppCatSubWorks = 0,
        oppCatSubMaterials = 0,
        oppCatWorksComp = 0,
        oppCatMaterialsComp = 0;

      category.children?.forEach((child) => {
        if (child.detail_cost_category_id) {
          const oppCosts = oppositeCostMap.get(child.detail_cost_category_id);
          if (oppCosts) {
            oppCatWorks += oppCosts.works;
            oppCatMaterials += oppCosts.materials;
            oppCatSubWorks += oppCosts.subWorks;
            oppCatSubMaterials += oppCosts.subMaterials;
            oppCatWorksComp += oppCosts.worksComp;
            oppCatMaterialsComp += oppCosts.materialsComp;
          }
        }
      });

      const oppCatTotalWorks = oppCatWorks + oppCatSubWorks + oppCatWorksComp;
      const oppCatTotalMaterials =
        oppCatMaterials + oppCatSubMaterials + oppCatMaterialsComp;
      const oppCatTotal = oppCatTotalWorks + oppCatTotalMaterials;

      // Строка категории
      exportData.push([
        `${catNum}. ${category.cost_category_name.toUpperCase()}`,
        '',
        categoryTotalVolume,
        category.children?.[0]?.unit || 'м2',
        category.works_cost,
        category.materials_cost,
        category.sub_works_cost,
        category.sub_materials_cost,
        category.works_comp_cost,
        category.materials_comp_cost,
        categoryTotalWorks,
        categoryTotalMaterials,
        category.total_cost,
        categoryTotalVolume ? categoryTotalWorks / categoryTotalVolume : '',
        categoryTotalVolume ? categoryTotalMaterials / categoryTotalVolume : '',
        categoryTotalVolume ? category.total_cost / categoryTotalVolume : '',
        oppCatWorks,
        oppCatMaterials,
        oppCatSubWorks,
        oppCatSubMaterials,
        oppCatWorksComp,
        oppCatMaterialsComp,
        oppCatTotalWorks,
        oppCatTotalMaterials,
        oppCatTotal,
        categoryTotalVolume ? oppCatTotalWorks / categoryTotalVolume : '',
        categoryTotalVolume ? oppCatTotalMaterials / categoryTotalVolume : '',
        categoryTotalVolume ? oppCatTotal / categoryTotalVolume : '',
        areaSp ? oppCatTotal / areaSp : '',
      ]);
      rowTypes.push('category');

      // Строки деталей (с учетом локализаций)
      let detailIndex = 1;
      const sortedChildren = category.children ? sortDetailRows(category.children, category.cost_category_name) : [];
      sortedChildren.forEach((child) => {
        if (child.is_location && child.total_cost > 0) {
          // Строка локализации
          const locationNum = `${catNum}.${String(detailIndex).padStart(2, '0')}.`;
          const locationTotalWorks =
            child.works_cost + child.sub_works_cost + child.works_comp_cost;
          const locationTotalMaterials =
            child.materials_cost +
            child.sub_materials_cost +
            child.materials_comp_cost;

          // Суммируем противоположные затраты для локализации
          let oppLocWorks = 0,
            oppLocMaterials = 0,
            oppLocSubWorks = 0,
            oppLocSubMaterials = 0,
            oppLocWorksComp = 0,
            oppLocMaterialsComp = 0;

          child.children?.forEach((detail) => {
            if (detail.detail_cost_category_id) {
              const oppCosts = oppositeCostMap.get(detail.detail_cost_category_id);
              if (oppCosts) {
                oppLocWorks += oppCosts.works;
                oppLocMaterials += oppCosts.materials;
                oppLocSubWorks += oppCosts.subWorks;
                oppLocSubMaterials += oppCosts.subMaterials;
                oppLocWorksComp += oppCosts.worksComp;
                oppLocMaterialsComp += oppCosts.materialsComp;
              }
            }
          });

          const oppLocTotalWorks = oppLocWorks + oppLocSubWorks + oppLocWorksComp;
          const oppLocTotalMaterials = oppLocMaterials + oppLocSubMaterials + oppLocMaterialsComp;
          const oppLocTotal = oppLocTotalWorks + oppLocTotalMaterials;

          exportData.push([
            `${locationNum} ${child.location_name}`,
            '',
            '',
            '',
            child.works_cost || '',
            child.materials_cost || '',
            child.sub_works_cost || '',
            child.sub_materials_cost || '',
            child.works_comp_cost || '',
            child.materials_comp_cost || '',
            locationTotalWorks || '',
            locationTotalMaterials || '',
            child.total_cost || '',
            '',
            '',
            '',
            oppLocWorks || '',
            oppLocMaterials || '',
            oppLocSubWorks || '',
            oppLocSubMaterials || '',
            oppLocWorksComp || '',
            oppLocMaterialsComp || '',
            oppLocTotalWorks || '',
            oppLocTotalMaterials || '',
            oppLocTotal || '',
            '',
            '',
            '',
            areaSp && oppLocTotal ? oppLocTotal / areaSp : '',
          ]);
          rowTypes.push('location');

          // Детали внутри локализации
          let locationDetailIndex = 1;
          const sortedLocationChildren = child.children ? sortDetailRows(child.children, category.cost_category_name, child.location_name) : [];
          sortedLocationChildren.forEach((detail) => {
            if (detail.total_cost > 0) {
              const detailNum = `${catNum}.${String(detailIndex).padStart(2, '0')}.${String(locationDetailIndex).padStart(2, '0')}.`;
              const detailTotalWorks =
                detail.works_cost + detail.sub_works_cost + detail.works_comp_cost;
              const detailTotalMaterials =
                detail.materials_cost +
                detail.sub_materials_cost +
                detail.materials_comp_cost;

              const oppDetailCosts = oppositeCostMap.get(
                detail.detail_cost_category_id || ''
              ) || {
                materials: 0,
                works: 0,
                subMaterials: 0,
                subWorks: 0,
                materialsComp: 0,
                worksComp: 0,
              };

              const oppDetailTotalWorks =
                oppDetailCosts.works +
                oppDetailCosts.subWorks +
                oppDetailCosts.worksComp;
              const oppDetailTotalMaterials =
                oppDetailCosts.materials +
                oppDetailCosts.subMaterials +
                oppDetailCosts.materialsComp;
              const oppDetailTotal = oppDetailTotalWorks + oppDetailTotalMaterials;

              exportData.push([
                `${detailNum} ${detail.detail_category_name}`,
                detail.location_name || '',
                detail.volume || '',
                detail.unit || '',
                detail.works_cost || '',
                detail.materials_cost || '',
                detail.sub_works_cost || '',
                detail.sub_materials_cost || '',
                detail.works_comp_cost || '',
                detail.materials_comp_cost || '',
                detailTotalWorks || '',
                detailTotalMaterials || '',
                detail.total_cost || '',
                detail.volume ? detailTotalWorks / detail.volume : '',
                detail.volume ? detailTotalMaterials / detail.volume : '',
                detail.volume ? detail.total_cost / detail.volume : '',
                oppDetailCosts.works || '',
                oppDetailCosts.materials || '',
                oppDetailCosts.subWorks || '',
                oppDetailCosts.subMaterials || '',
                oppDetailCosts.worksComp || '',
                oppDetailCosts.materialsComp || '',
                oppDetailTotalWorks || '',
                oppDetailTotalMaterials || '',
                oppDetailTotal || '',
                detail.volume ? oppDetailTotalWorks / detail.volume : '',
                detail.volume ? oppDetailTotalMaterials / detail.volume : '',
                detail.volume ? oppDetailTotal / detail.volume : '',
                areaSp && oppDetailTotal ? oppDetailTotal / areaSp : '',
              ]);
              rowTypes.push('detail');

              locationDetailIndex++;
            }
          });

          detailIndex++;
        } else if (!child.is_location && child.total_cost > 0) {
          // Обычная детальная строка (без локализации)
          const detailNum = `${catNum}.${String(detailIndex).padStart(2, '0')}.`;
          const detailTotalWorks =
            child.works_cost + child.sub_works_cost + child.works_comp_cost;
          const detailTotalMaterials =
            child.materials_cost +
            child.sub_materials_cost +
            child.materials_comp_cost;

          const oppDetailCosts = oppositeCostMap.get(
            child.detail_cost_category_id || ''
          ) || {
            materials: 0,
            works: 0,
            subMaterials: 0,
            subWorks: 0,
            materialsComp: 0,
            worksComp: 0,
          };

          const oppDetailTotalWorks =
            oppDetailCosts.works +
            oppDetailCosts.subWorks +
            oppDetailCosts.worksComp;
          const oppDetailTotalMaterials =
            oppDetailCosts.materials +
            oppDetailCosts.subMaterials +
            oppDetailCosts.materialsComp;
          const oppDetailTotal = oppDetailTotalWorks + oppDetailTotalMaterials;

          exportData.push([
            `${detailNum} ${child.detail_category_name}`,
            child.location_name || '',
            child.volume || '',
            child.unit || '',
            child.works_cost || '',
            child.materials_cost || '',
            child.sub_works_cost || '',
            child.sub_materials_cost || '',
            child.works_comp_cost || '',
            child.materials_comp_cost || '',
            detailTotalWorks || '',
            detailTotalMaterials || '',
            child.total_cost || '',
            child.volume ? detailTotalWorks / child.volume : '',
            child.volume ? detailTotalMaterials / child.volume : '',
            child.volume ? child.total_cost / child.volume : '',
            oppDetailCosts.works || '',
            oppDetailCosts.materials || '',
            oppDetailCosts.subWorks || '',
            oppDetailCosts.subMaterials || '',
            oppDetailCosts.worksComp || '',
            oppDetailCosts.materialsComp || '',
            oppDetailTotalWorks || '',
            oppDetailTotalMaterials || '',
            oppDetailTotal || '',
            child.volume ? oppDetailTotalWorks / child.volume : '',
            child.volume ? oppDetailTotalMaterials / child.volume : '',
            child.volume ? oppDetailTotal / child.volume : '',
            areaSp && oppDetailTotal ? oppDetailTotal / areaSp : '',
          ]);
          rowTypes.push('detail');

          detailIndex++;
        }
      });

      categoryIndex++;
    }
  });

  return { data: exportData, rowTypes };
}
