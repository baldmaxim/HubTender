import { listBoqItemsFullByTender } from '../../../../lib/api/positions';

export interface OppositeCosts {
  materials: number;
  works: number;
  subMaterials: number;
  subWorks: number;
  materialsComp: number;
  worksComp: number;
}

/**
 * Получает данные для противоположного типа затрат
 */
export async function fetchOppositeCosts(
  tenderId: string,
  currentCostType: 'base' | 'commercial'
): Promise<Map<string, OppositeCosts>> {
  const oppositeType = currentCostType === 'base' ? 'commercial' : 'base';

  const oppositeBOQItems = await listBoqItemsFullByTender(tenderId);

  const oppositeCostMap = new Map<string, OppositeCosts>();

  type OppItem = { detail_cost_category_id: string | null; boq_item_type: string | null; total_amount?: number | null; total_commercial_material_cost?: number | null; total_commercial_work_cost?: number | null };
  (oppositeBOQItems as unknown as OppItem[]).forEach((item) => {
    const catId = item.detail_cost_category_id;
    if (!catId) return;

    if (!oppositeCostMap.has(catId)) {
      oppositeCostMap.set(catId, {
        materials: 0,
        works: 0,
        subMaterials: 0,
        subWorks: 0,
        materialsComp: 0,
        worksComp: 0,
      });
    }

    const costs = oppositeCostMap.get(catId)!;

    if (oppositeType === 'base') {
      const amount = item.total_amount || 0;
      switch (item.boq_item_type) {
        case 'мат':
          costs.materials += amount;
          break;
        case 'суб-мат':
          costs.subMaterials += amount;
          break;
        case 'мат-комп.':
          costs.materialsComp += amount;
          break;
        case 'раб':
          costs.works += amount;
          break;
        case 'суб-раб':
          costs.subWorks += amount;
          break;
        case 'раб-комп.':
          costs.worksComp += amount;
          break;
      }
    } else {
      const materialCost = item.total_commercial_material_cost || 0;
      const workCost = item.total_commercial_work_cost || 0;

      switch (item.boq_item_type) {
        case 'мат':
          costs.materials += materialCost;
          break;
        case 'суб-мат':
          costs.subMaterials += materialCost;
          break;
        case 'мат-комп.':
          costs.materialsComp += materialCost;
          break;
        case 'раб':
          costs.works += workCost;
          break;
        case 'суб-раб':
          costs.subWorks += workCost;
          break;
        case 'раб-комп.':
          costs.worksComp += workCost;
          break;
      }
    }
  });

  return oppositeCostMap;
}
