/**
 * Подсчёт сводных итогов по строкам затрат.
 * Используется и таблицей (Table.Summary), и закреплённой полосой итогов (CostTotalsBar).
 */
import type { CostRow } from '../hooks/useCostData';

export interface CostTotals {
  materials: number;
  works: number;
  subMaterials: number;
  subWorks: number;
  materialsComp: number;
  worksComp: number;
  totalWorks: number;
  totalMaterials: number;
  total: number;
}

export function computeCostTotals(data: CostRow[]): CostTotals {
  return data.reduce<CostTotals>(
    (acc, row) => ({
      materials: acc.materials + row.materials_cost,
      works: acc.works + row.works_cost,
      subMaterials: acc.subMaterials + row.sub_materials_cost,
      subWorks: acc.subWorks + row.sub_works_cost,
      materialsComp: acc.materialsComp + row.materials_comp_cost,
      worksComp: acc.worksComp + row.works_comp_cost,
      totalWorks: acc.totalWorks + row.works_cost + row.sub_works_cost + row.works_comp_cost,
      totalMaterials:
        acc.totalMaterials + row.materials_cost + row.sub_materials_cost + row.materials_comp_cost,
      total: acc.total + row.total_cost,
    }),
    {
      materials: 0,
      works: 0,
      subMaterials: 0,
      subWorks: 0,
      materialsComp: 0,
      worksComp: 0,
      totalWorks: 0,
      totalMaterials: 0,
      total: 0,
    },
  );
}
