import { calculateBoqItemTotalAmount } from '../../../utils/boq/calculateBoqAmount';
import type {
  getTenderById,
  listSubcontractGrowthExclusions,
  BoqItemWithPosition,
} from '../../../lib/api/fi';
import type { DirectCostTotals } from '../types';

type TenderFI = Awaited<ReturnType<typeof getTenderById>>;
type SubcontractExclusions = Awaited<ReturnType<typeof listSubcontractGrowthExclusions>>;

/**
 * Агрегация прямых затрат по BOQ-элементам тендера (с учётом исключений
 * категорий для роста субподряда). Перенесено из useFinancialCalculations
 * без изменений логики; console.log — намеренный кросс-чек с Commerce.
 */
export const aggregateDirectCosts = (
  boqItems: BoqItemWithPosition[] | null | undefined,
  tender: TenderFI,
  exclusions: SubcontractExclusions,
): DirectCostTotals => {
  const excludedWorksCategories = new Set(
    exclusions?.filter(e => e.exclusion_type === 'works').map(e => e.detail_cost_category_id) || []
  );
  const excludedMaterialsCategories = new Set(
    exclusions?.filter(e => e.exclusion_type === 'materials').map(e => e.detail_cost_category_id) || []
  );

  // Расчет прямых затрат
  let subcontractWorks = 0;
  let subcontractMaterials = 0;
  let subcontractWorksForGrowth = 0; // Субподряд работы для расчета роста (с учетом исключений)
  let subcontractMaterialsForGrowth = 0; // Субподряд материалы для расчета роста (с учетом исключений)
  let works = 0;
  let materials = 0;
  let materialsComp = 0;
  let worksComp = 0;

  // Суммы коммерческих стоимостей из boq_items (для сравнения с Commerce страницей)
  let totalCommercialMaterial = 0;
  let totalCommercialWork = 0;

  boqItems?.forEach(item => {
    const baseCost = calculateBoqItemTotalAmount(item, tender);
    // Добавляем коммерческие стоимости
    totalCommercialMaterial += item.total_commercial_material_cost || 0;
    totalCommercialWork += item.total_commercial_work_cost || 0;
    const categoryId = item.detail_cost_category_id;
    const itemType = item.boq_item_type?.trim();

    switch (itemType) {
      case 'суб-раб':
        subcontractWorks += baseCost;
        if (!(categoryId && excludedWorksCategories.has(categoryId))) {
          subcontractWorksForGrowth += baseCost;
        }
        break;
      case 'суб-мат':
        subcontractMaterials += baseCost;
        if (!(categoryId && excludedMaterialsCategories.has(categoryId))) {
          subcontractMaterialsForGrowth += baseCost;
        }
        break;
      case 'раб':
        works += baseCost;
        break;
      case 'мат':
        materials += baseCost;
        break;
      case 'мат-комп.':
      case 'мат-комп':
        materialsComp += baseCost;
        break;
      case 'раб-комп.':
      case 'раб-комп':
        worksComp += baseCost;
        break;
      default:
        if (itemType && baseCost > 0) {
          console.warn(`[FinancialIndicators] Неизвестный тип BOQ: "${itemType}", сумма: ${baseCost}`);
        }
    }
  });

  console.log('=== BOQ Items Stats (FINANCIAL INDICATORS) ===');
  console.log('Total BOQ items:', boqItems?.length || 0);
  console.log('--- БАЗОВЫЕ СУММЫ ПО ТИПАМ (total_amount) ---');
  console.log('  суб-раб (subcontractWorks):', subcontractWorks.toLocaleString('ru-RU'));
  console.log('  суб-мат (subcontractMaterials):', subcontractMaterials.toLocaleString('ru-RU'));
  console.log('  раб (works):', works.toLocaleString('ru-RU'));
  console.log('  мат (materials):', materials.toLocaleString('ru-RU'));
  console.log('  мат-комп. (materialsComp):', materialsComp.toLocaleString('ru-RU'));
  console.log('  раб-комп. (worksComp):', worksComp.toLocaleString('ru-RU'));
  console.log('  ИТОГО база:', (subcontractWorks + subcontractMaterials + works + materials + materialsComp + worksComp).toLocaleString('ru-RU'));
  console.log('--- КОММЕРЧЕСКИЕ СТОИМОСТИ ИЗ boq_items ---');
  console.log('  Commercial Material (sum of total_commercial_material_cost):', totalCommercialMaterial.toLocaleString('ru-RU'));
  console.log('  Commercial Work (sum of total_commercial_work_cost):', totalCommercialWork.toLocaleString('ru-RU'));
  console.log('  Commercial TOTAL (из boq_items):', (totalCommercialMaterial + totalCommercialWork).toLocaleString('ru-RU'));
  console.log('=======================');

  return {
    subcontractWorks,
    subcontractMaterials,
    subcontractWorksForGrowth,
    subcontractMaterialsForGrowth,
    works,
    materials,
    materialsComp,
    worksComp,
    totalCommercialMaterial,
    totalCommercialWork,
  };
};
