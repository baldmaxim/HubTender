import { totalAmountFX, dedupeCurrencies, type FXResult } from '../../../utils/boq/currencyGuard';
import type { CurrencyType } from '../../../lib/types';
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
 * категорий для роста субподряда).
 *
 * Fail-closed: если хотя бы у одного элемента отсутствует курс валюты, весь
 * итог тендера недоступен (value=null) с перечнем валют — частичная сумма НЕ
 * возвращается (нельзя пропустить ошибочную строку и сложить остальные).
 */
export const aggregateDirectCosts = (
  boqItems: BoqItemWithPosition[] | null | undefined,
  tender: TenderFI,
  exclusions: SubcontractExclusions,
): FXResult<DirectCostTotals> => {
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

  const missing: CurrencyType[] = [];

  boqItems?.forEach(item => {
    // Fail-closed: нет курса → помечаем весь итог недоступным, не суммируем частично.
    const baseCostFX = totalAmountFX(item, tender);
    if (baseCostFX.value === null) {
      missing.push(...baseCostFX.missingCurrencies);
      return;
    }
    const baseCost = baseCostFX.value;
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

  // Fail-closed: хотя бы одна строка без курса → весь итог тендера не рассчитан.
  if (missing.length > 0) {
    return { value: null, missingCurrencies: dedupeCurrencies(missing) };
  }

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
    value: {
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
    },
    missingCurrencies: [],
  };
};
