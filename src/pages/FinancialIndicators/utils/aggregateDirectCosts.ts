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

/** Нулевые прямые затраты — стартовое состояние аккумулятора. */
export const emptyDirectCostTotals = (): DirectCostTotals => ({
  subcontractWorks: 0,
  subcontractMaterials: 0,
  subcontractWorksForGrowth: 0,
  subcontractMaterialsForGrowth: 0,
  works: 0,
  materials: 0,
  materialsComp: 0,
  worksComp: 0,
  totalCommercialMaterial: 0,
  totalCommercialWork: 0,
});

/** Множества категорий, исключённых из базы роста субподряда. */
export interface GrowthExclusionSets {
  works: Set<string>;
  materials: Set<string>;
}

export const buildGrowthExclusionSets = (
  exclusions: SubcontractExclusions,
): GrowthExclusionSets => ({
  works: new Set(
    exclusions?.filter(e => e.exclusion_type === 'works').map(e => e.detail_cost_category_id) || []
  ),
  materials: new Set(
    exclusions?.filter(e => e.exclusion_type === 'materials').map(e => e.detail_cost_category_id) || []
  ),
});

/**
 * Добавить один BOQ-элемент в аккумулятор прямых затрат (мутирует `acc`).
 *
 * Единственное место, где тип BOQ раскладывается по корзинам, — используется и
 * общим агрегатом тендера, и per-position агрегатами механизма снижения.
 * Возвращает false, если у элемента нет курса валюты (вызывающий решает,
 * что делать: общий агрегат — fail-closed на весь тендер).
 */
export const accumulateDirectCost = (
  acc: DirectCostTotals,
  item: BoqItemWithPosition,
  tender: TenderFI,
  excluded: GrowthExclusionSets,
  missingOut?: CurrencyType[],
): boolean => {
  const baseCostFX = totalAmountFX(item, tender);
  if (baseCostFX.value === null) {
    missingOut?.push(...baseCostFX.missingCurrencies);
    return false;
  }
  const baseCost = baseCostFX.value;

  acc.totalCommercialMaterial += item.total_commercial_material_cost || 0;
  acc.totalCommercialWork += item.total_commercial_work_cost || 0;

  const categoryId = item.detail_cost_category_id;
  const itemType = item.boq_item_type?.trim();

  switch (itemType) {
    case 'суб-раб':
      acc.subcontractWorks += baseCost;
      if (!(categoryId && excluded.works.has(categoryId))) {
        acc.subcontractWorksForGrowth += baseCost;
      }
      break;
    case 'суб-мат':
      acc.subcontractMaterials += baseCost;
      if (!(categoryId && excluded.materials.has(categoryId))) {
        acc.subcontractMaterialsForGrowth += baseCost;
      }
      break;
    case 'раб':
      acc.works += baseCost;
      break;
    case 'мат':
      acc.materials += baseCost;
      break;
    case 'мат-комп.':
    case 'мат-комп':
      acc.materialsComp += baseCost;
      break;
    case 'раб-комп.':
    case 'раб-комп':
      acc.worksComp += baseCost;
      break;
    default:
      if (itemType && baseCost > 0) {
        console.warn(`[FinancialIndicators] Неизвестный тип BOQ: "${itemType}", сумма: ${baseCost}`);
      }
  }
  return true;
};

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
  const excluded = buildGrowthExclusionSets(exclusions);
  const acc = emptyDirectCostTotals();
  const missing: CurrencyType[] = [];

  boqItems?.forEach(item => {
    accumulateDirectCost(acc, item, tender, excluded, missing);
  });

  // Fail-closed: хотя бы одна строка без курса → весь итог тендера не рассчитан.
  if (missing.length > 0) {
    return { value: null, missingCurrencies: dedupeCurrencies(missing) };
  }

  console.log('=== BOQ Items Stats (FINANCIAL INDICATORS) ===');
  console.log('Total BOQ items:', boqItems?.length || 0);
  console.log('--- БАЗОВЫЕ СУММЫ ПО ТИПАМ (total_amount) ---');
  console.log('  суб-раб (subcontractWorks):', acc.subcontractWorks.toLocaleString('ru-RU'));
  console.log('  суб-мат (subcontractMaterials):', acc.subcontractMaterials.toLocaleString('ru-RU'));
  console.log('  раб (works):', acc.works.toLocaleString('ru-RU'));
  console.log('  мат (materials):', acc.materials.toLocaleString('ru-RU'));
  console.log('  мат-комп. (materialsComp):', acc.materialsComp.toLocaleString('ru-RU'));
  console.log('  раб-комп. (worksComp):', acc.worksComp.toLocaleString('ru-RU'));
  console.log('  ИТОГО база:', (acc.subcontractWorks + acc.subcontractMaterials + acc.works + acc.materials + acc.materialsComp + acc.worksComp).toLocaleString('ru-RU'));
  console.log('--- КОММЕРЧЕСКИЕ СТОИМОСТИ ИЗ boq_items ---');
  console.log('  Commercial Material (sum of total_commercial_material_cost):', acc.totalCommercialMaterial.toLocaleString('ru-RU'));
  console.log('  Commercial Work (sum of total_commercial_work_cost):', acc.totalCommercialWork.toLocaleString('ru-RU'));
  console.log('  Commercial TOTAL (из boq_items):', (acc.totalCommercialMaterial + acc.totalCommercialWork).toLocaleString('ru-RU'));
  console.log('=======================');

  return { value: acc, missingCurrencies: [] };
};
