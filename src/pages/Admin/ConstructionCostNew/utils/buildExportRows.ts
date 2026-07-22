import type { CostRow, CostSums } from '../types';
import { sortDetailRows } from './sortDetailRows';

// Типы строк для стилизации
export type RowType = 'header' | 'subheader' | 'supergroup' | 'category' | 'location' | 'detail';

export interface ExportDataWithTypes {
  data: (string | number)[][];
  rowTypes: RowType[];
}

const emptySums = (): CostSums => ({
  materials: 0,
  works: 0,
  subMaterials: 0,
  subWorks: 0,
  materialsComp: 0,
  worksComp: 0,
});

/** Шестёрка сумм из строки дерева (данные активной вкладки). */
const rowSums = (row: CostRow): CostSums => ({
  materials: row.materials_cost,
  works: row.works_cost,
  subMaterials: row.sub_materials_cost,
  subWorks: row.sub_works_cost,
  materialsComp: row.materials_comp_cost,
  worksComp: row.works_comp_cost,
});

const addSums = (acc: CostSums, add: CostSums): void => {
  acc.materials += add.materials;
  acc.works += add.works;
  acc.subMaterials += add.subMaterials;
  acc.subWorks += add.subWorks;
  acc.materialsComp += add.materialsComp;
  acc.worksComp += add.worksComp;
};

const totalWorks = (s: CostSums) => s.works + s.subWorks + s.worksComp;
const totalMaterials = (s: CostSums) => s.materials + s.subMaterials + s.materialsComp;
const grandTotal = (s: CostSums) => totalWorks(s) + totalMaterials(s);

const perUnit = (value: number, divider: number): number | '' => (divider ? value / divider : '');

/**
 * Блок из 12 колонок (6 типов + 3 итога + 3 «за единицу»).
 * `zeroBlank` — печатать нули пустыми ячейками (строки локализаций и деталей).
 * `withPerUnit=false` — не выводить «за единицу» (строки локализаций).
 */
function costBlock(
  s: CostSums,
  volume: number,
  zeroBlank: boolean,
  withPerUnit: boolean
): (string | number)[] {
  const w = totalWorks(s);
  const m = totalMaterials(s);
  const t = w + m;
  const cell = (v: number): string | number => (zeroBlank ? v || '' : v);
  return [
    cell(s.works),
    cell(s.materials),
    cell(s.subWorks),
    cell(s.subMaterials),
    cell(s.worksComp),
    cell(s.materialsComp),
    cell(w),
    cell(m),
    cell(t),
    withPerUnit ? perUnit(w, volume) : '',
    withPerUnit ? perUnit(m, volume) : '',
    withPerUnit ? perUnit(t, volume) : '',
  ];
}

/**
 * Формирует данные для экспорта в Excel.
 *
 * Раскладка колонок фиксирована: 4–15 — «Прямые Затраты», 16–28 —
 * «Коммерческие Затраты». Активная вкладка (`costType`) определяет только,
 * какой из источников (строки дерева / карта противоположных сумм) попадёт
 * в какой блок.
 */
export function buildExportData(
  filteredData: CostRow[],
  oppositeCostMap: Map<string, CostSums>,
  areaSp: number,
  costType: 'base' | 'commercial'
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

  // Опп. затраты по всему поддереву строки: у категорий с несколькими
  // локализациями прямые children — строки локализаций без
  // detail_cost_category_id, поэтому обход обязан быть рекурсивным.
  const sumOppositeSubtree = (r: CostRow): CostSums => {
    const acc = emptySums();
    const walk = (node: CostRow) => {
      if (node.detail_cost_category_id) {
        const o = oppositeCostMap.get(node.detail_cost_category_id);
        if (o) addSums(acc, o);
      }
      node.children?.forEach(walk);
    };
    walk(r);
    return acc;
  };

  // Активная вкладка → левый блок прямых, правый — коммерческих.
  const splitBlocks = (row: CostRow): { direct: CostSums; commercial: CostSums } => {
    const own = rowSums(row);
    const opp = sumOppositeSubtree(row);
    return costType === 'base'
      ? { direct: own, commercial: opp }
      : { direct: opp, commercial: own };
  };

  const emitRow = (
    label: string,
    location: string | number,
    volumeCell: string | number,
    unit: string,
    row: CostRow,
    volume: number,
    type: RowType
  ): void => {
    const { direct, commercial } = splitBlocks(row);
    const zeroBlank = type === 'location' || type === 'detail';
    const withPerUnit = type !== 'location';
    const commTotal = grandTotal(commercial);
    exportData.push([
      label,
      location,
      volumeCell,
      unit,
      ...costBlock(direct, volume, zeroBlank, withPerUnit),
      ...costBlock(commercial, volume, zeroBlank, withPerUnit),
      areaSp && commTotal ? commTotal / areaSp : '',
    ]);
    rowTypes.push(type);
  };

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

  let categoryIndex = 1;

  emitList.forEach(({ type, row }) => {
    if (type === 'supergroup') {
      const superVolume = row.volume || 0;
      emitRow(
        row.cost_category_name.toUpperCase(),
        '',
        superVolume,
        'м2',
        row,
        superVolume,
        'supergroup'
      );
      return;
    }

    const category = row;
    if (!category.is_category || category.total_cost <= 0) return;

    const catNum = String(categoryIndex).padStart(2, '0');
    const categoryTotalVolume = category.volume || 0;

    emitRow(
      `${catNum}. ${category.cost_category_name.toUpperCase()}`,
      '',
      categoryTotalVolume,
      category.children?.[0]?.unit || 'м2',
      category,
      categoryTotalVolume,
      'category'
    );

    // Строки деталей (с учетом локализаций)
    let detailIndex = 1;
    const sortedChildren = category.children
      ? sortDetailRows(category.children, category.cost_category_name)
      : [];

    sortedChildren.forEach((child) => {
      if (child.is_location && child.total_cost > 0) {
        const locationNum = `${catNum}.${String(detailIndex).padStart(2, '0')}.`;
        emitRow(`${locationNum} ${child.location_name}`, '', '', '', child, 0, 'location');

        // Детали внутри локализации
        let locationDetailIndex = 1;
        const sortedLocationChildren = child.children
          ? sortDetailRows(child.children, category.cost_category_name, child.location_name)
          : [];
        sortedLocationChildren.forEach((detail) => {
          if (detail.total_cost > 0) {
            const detailNum = `${catNum}.${String(detailIndex).padStart(2, '0')}.${String(locationDetailIndex).padStart(2, '0')}.`;
            emitRow(
              `${detailNum} ${detail.detail_category_name}`,
              detail.location_name || '',
              detail.volume || '',
              detail.unit || '',
              detail,
              detail.volume || 0,
              'detail'
            );
            locationDetailIndex++;
          }
        });

        detailIndex++;
      } else if (!child.is_location && child.total_cost > 0) {
        // Обычная детальная строка (без локализации)
        const detailNum = `${catNum}.${String(detailIndex).padStart(2, '0')}.`;
        emitRow(
          `${detailNum} ${child.detail_category_name}`,
          child.location_name || '',
          child.volume || '',
          child.unit || '',
          child,
          child.volume || 0,
          'detail'
        );
        detailIndex++;
      }
    });

    categoryIndex++;
  });

  return { data: exportData, rowTypes };
}
