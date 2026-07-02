import {
  calculateLiveCommercialAmounts,
  type loadLiveCommercialCalculationContext,
} from '../../../../utils/boq/liveCommercialCalculation';
import type { BoqItemForCost, CostSums } from '../types';

type LiveCalculationContext = Awaited<ReturnType<typeof loadLiveCommercialCalculationContext>>;

/**
 * Агрегирует BOQ-элементы тендера в суммы затрат по detail_cost_category_id
 * (элементы без категории попадают в ключ 'uncategorized').
 * Чистая функция — перенесена из fetchConstructionCosts без изменений логики.
 */
export const aggregateBoqCosts = (
  boqItems: BoqItemForCost[] | null | undefined,
  costType: 'base' | 'commercial',
  calculationContext: LiveCalculationContext,
): Map<string, CostSums> => {
  const costMap = new Map<string, CostSums>();

  (boqItems || []).forEach((item) => {
    const catId = item.detail_cost_category_id || 'uncategorized';

    if (!costMap.has(catId)) {
      costMap.set(catId, { materials: 0, works: 0, subMaterials: 0, subWorks: 0, materialsComp: 0, worksComp: 0 });
    }

    const costs = costMap.get(catId)!;
    const liveAmounts = calculateLiveCommercialAmounts(item as unknown as Parameters<typeof calculateLiveCommercialAmounts>[0], calculationContext);

    if (costType === 'base') {
      const amount = liveAmounts.baseAmount;
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
      const materialCost = liveAmounts.materialCost;
      const workCost = liveAmounts.workCost;

      // Просто распределяем по типам элементов
      // total_commercial_material_cost и total_commercial_work_cost уже содержат правильные суммы
      switch (item.boq_item_type) {
        case 'мат':
          costs.materials += materialCost;
          costs.works += workCost;
          break;
        case 'суб-мат':
          costs.subMaterials += materialCost;
          costs.subWorks += workCost;
          break;
        case 'мат-комп.':
          costs.materialsComp += materialCost;
          costs.worksComp += workCost;
          break;
        case 'раб':
          costs.materials += materialCost;
          costs.works += workCost;
          break;
        case 'суб-раб':
          costs.subMaterials += materialCost;
          costs.subWorks += workCost;
          break;
        case 'раб-комп.':
          costs.materialsComp += materialCost;
          costs.worksComp += workCost;
          break;
      }
    }
  });

  return costMap;
};
