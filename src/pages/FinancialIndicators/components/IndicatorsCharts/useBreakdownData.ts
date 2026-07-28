import { useState } from 'react';
import { totalAmountFX } from '../../../../utils/boq/currencyGuard';
import {
  calculateLiveCommercialAmounts,
  loadLiveCommercialCalculationContext,
  resetLiveCommercialCalculationCache,
} from '../../../../utils/boq/liveCommercialCalculation';
import { getTenderById } from '../../../../lib/api/fi';
import { listBoqItemsFullByTender } from '../../../../lib/api/positions';
import { listDetailCostCategoriesWithCategory } from '../../../../lib/api/costs';
import { listConstructionCostVolumes } from '../../../../lib/api/constructionCostVolumes';
import type { BoqItemScale, CategoryBreakdown, ReferenceInfo, TenderRates } from './types';
import { hasDetailedBreakdown } from './drillDownRows';

/**
 * Загрузка детализации по категориям затрат и справочной информации
 * (стоимости монолита/ВИС/фасадов за единицу). Перенесено из
 * IndicatorsCharts без изменений логики.
 */
export const useBreakdownData = ({
  selectedTenderId,
  isVatInConstructor,
  vatCoefficient,
  itemScale,
}: {
  selectedTenderId: string | null;
  isVatInConstructor: boolean;
  vatCoefficient: number;
  itemScale?: BoqItemScale | null;
}) => {
  const [selectedIndicator, setSelectedIndicator] = useState<number | null>(null);
  const [breakdownData, setBreakdownData] = useState<CategoryBreakdown[]>([]);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);

  // Справочная информация
  const [referenceInfo, setReferenceInfo] = useState<ReferenceInfo>({
    monolithPerM3: 0,
    visPerM2: 0,
    facadePerM2: 0,
  });

  const loadTenderRates = async (): Promise<TenderRates> => {
    if (!selectedTenderId) {
      return { usd_rate: 0, eur_rate: 0, cny_rate: 0 };
    }
    const t = await getTenderById(selectedTenderId);
    return {
      usd_rate: t?.usd_rate || 0,
      eur_rate: t?.eur_rate || 0,
      cny_rate: t?.cny_rate || 0,
    };
  };

  // Загрузка детализации по категориям затрат для выбранного индикатора
  const fetchCategoryBreakdown = async (rowNumber: number) => {
    if (!selectedTenderId) return;

    setLoadingBreakdown(true);
    try {
      const tenderRates = await loadTenderRates();
      // Проверяем, доступна ли детализация
      if (!hasDetailedBreakdown(rowNumber)) {
        // Для показателей без привязки к BOQ показываем пустой массив
        setBreakdownData([]);
        setLoadingBreakdown(false);
        return;
      }

      // Определяем тип элементов для фильтрации
      let boqItemTypes: string[] = [];

      switch (rowNumber) {
        case 2: // Субподряд
          boqItemTypes = ['суб-раб', 'суб-мат'];
          break;
        case 3: // Работы + Материалы СУ-10
          boqItemTypes = ['раб', 'мат'];
          break;
        case 4: // Запас на сдачу объекта
          boqItemTypes = ['мат-комп.', 'раб-комп.'];
          break;
        default:
          boqItemTypes = [];
      }

      const allBoqItems = await listBoqItemsFullByTender(selectedTenderId);
      const typeSet = new Set(boqItemTypes);
      const boqItems = (allBoqItems as unknown as Array<{
        client_position_id: string | null;
        material_type: string | null;
        boq_item_type: string | null;
        total_amount: number | null;
        quantity: number | null;
        unit_rate: number | null;
        currency_type: string | null;
        delivery_price_type: string | null;
        delivery_amount: number | null;
        consumption_coefficient: number | null;
        parent_work_item_id: string | null;
        detail_cost_categories: { name?: string | null; location?: string | null; cost_categories: { name?: string | null } | null } | null;
      }>).filter((i) => i.boq_item_type && typeSet.has(i.boq_item_type));

      if (boqItems.length === 0) {
        setBreakdownData([]);
        return;
      }

      // Fail-closed: хотя бы у одного элемента нет курса → детализация недоступна
      // (не показываем частичную разбивку). Общий Alert — на уровне страницы.
      const bdUnavailable = boqItems.some(
        (item) => totalAmountFX(item as unknown as Parameters<typeof totalAmountFX>[0], tenderRates).value === null,
      );
      if (bdUnavailable) {
        setBreakdownData([]);
        return;
      }

      const categoryMap = new Map<string, CategoryBreakdown>();

      boqItems.forEach(item => {
        const detailCategory = item.detail_cost_categories;
        const categoryObj = detailCategory?.cost_categories || null;

        const vatMultiplier = (isVatInConstructor && vatCoefficient > 0) ? (1 + vatCoefficient / 100) : 1;
        const baseFX = totalAmountFX(item as unknown as Parameters<typeof totalAmountFX>[0], tenderRates);
        if (baseFX.value === null) return;
        // Снижение: детализация должна складываться в то же ИТОГО, что и таблица.
        const scale = itemScale
          ? itemScale(item.client_position_id, item.boq_item_type, item.material_type)
          : 1;
        const amount = baseFX.value * vatMultiplier * scale;
        const isWork = item.boq_item_type === 'раб' || item.boq_item_type === 'суб-раб' || item.boq_item_type === 'раб-комп.';

        // Для строки 4 (запас на сдачу) группируем по виду затрат
        if (rowNumber === 4) {
          const detailCategoryName = categoryObj?.name || 'Без категории';
          const detailName = detailCategory?.name || 'Без вида';
          const locationName = detailCategory?.location || 'Без локализации';

          // Используем вид затрат для названия категории (а не тип элемента)
          const categoryName = detailName;

          // Ключ: вид + локализация
          const key = `${detailName}|${locationName}`;

          if (!categoryMap.has(key)) {
            categoryMap.set(key, {
              category_name: categoryName,
              detail_name: detailCategoryName,
              location_name: locationName,
              total_amount: 0,
              works_amount: 0,
              materials_amount: 0,
            });
          }

          const cat = categoryMap.get(key)!;
          cat.total_amount += amount;

          if (isWork) {
            cat.works_amount += amount;
          } else {
            cat.materials_amount += amount;
          }
        } else {
          // Для остальных строк группируем по категории затрат
          const categoryName = categoryObj?.name || 'Без категории';
          const detailName = detailCategory?.name || 'Без вида';
          const locationName = detailCategory?.location || 'Без локализации';

          // Ключ: категория + вид + локализация для группировки
          const key = `${categoryName}|${detailName}|${locationName}`;

          if (!categoryMap.has(key)) {
            categoryMap.set(key, {
              category_name: categoryName,
              detail_name: detailName,
              location_name: locationName,
              total_amount: 0,
              works_amount: 0,
              materials_amount: 0,
            });
          }

          const cat = categoryMap.get(key)!;
          cat.total_amount += amount;

          if (isWork) {
            cat.works_amount += amount;
          } else {
            cat.materials_amount += amount;
          }
        }
      });

      const breakdown = Array.from(categoryMap.values())
        .sort((a, b) => b.total_amount - a.total_amount);

      setBreakdownData(breakdown);
    } catch (error) {
      console.error('Ошибка загрузки детализации:', error);
      setBreakdownData([]);
    } finally {
      setLoadingBreakdown(false);
    }
  };

  // Загрузка справочной информации (коммерческие стоимости из затрат на строительство)
  const fetchReferenceInfo = async () => {
    if (!selectedTenderId) return;

    try {
      const calculationContext = await loadLiveCommercialCalculationContext(selectedTenderId);
      const categories = await listDetailCostCategoriesWithCategory();

      const detailToCategoryName = new Map<string, string>();
      categories.forEach((cat) => {
        const name = cat.cost_categories?.name || '';
        if (name) detailToCategoryName.set(cat.id, name);
      });

      const volumes = await listConstructionCostVolumes(selectedTenderId);
      const groupVolumes = new Map<string, number>();
      const detailVolumes = new Map<string, number>();

      volumes.forEach((v) => {
        if (v.group_key) {
          groupVolumes.set(v.group_key, v.volume || 0);
        } else if (v.detail_cost_category_id) {
          detailVolumes.set(v.detail_cost_category_id, v.volume || 0);
        }
      });

      // Агрегируем detail-level объёмы по категориям (фоллбэк если нет group volume)
      const aggregatedVolumes = new Map<string, number>();
      for (const [detailId, volume] of detailVolumes.entries()) {
        const categoryName = detailToCategoryName.get(detailId);
        if (categoryName) {
          aggregatedVolumes.set(categoryName, (aggregatedVolumes.get(categoryName) || 0) + volume);
        }
      }

      // Получаем объём категории: сначала group volume, иначе сумма detail volumes
      const getCategoryVolume = (categoryName: string): number => {
        const groupVol = groupVolumes.get(`category-${categoryName}`);
        if (groupVol && groupVol > 0) return groupVol;
        return aggregatedVolumes.get(categoryName) || 0;
      };

      // 3. Загружаем boq_items со стоимостями (батчинг)
      const targetCategories = new Set([
        'МОНОЛИТНЫЕ РАБОТЫ',
        'ВИС / Механические инженерные системы',
        'ВИС / Электрические системы',
        'ВИС / Слаботочные системы, автоматика и диспетчеризация',
        'ФАСАДНЫЕ РАБОТЫ',
      ]);

      const commercialCostByCategory = new Map<string, number>();
      const baseCostByCategory = new Map<string, number>();

      resetLiveCommercialCalculationCache();

      const boqRows = (await listBoqItemsFullByTender(selectedTenderId)) as unknown as Array<{
        detail_cost_category_id: string | null;
      }>;
      // Fail-closed: любой элемент без курса → справочные цены недоступны, не
      // копим частичные суммы (оставляем нули → «—» в справке).
      const refUnavailable = boqRows.some((rawItem) => {
        const categoryName = rawItem.detail_cost_category_id
          ? detailToCategoryName.get(rawItem.detail_cost_category_id) || ''
          : '';
        if (!targetCategories.has(categoryName)) return false;
        return calculateLiveCommercialAmounts(
          rawItem as unknown as Parameters<typeof calculateLiveCommercialAmounts>[0],
          calculationContext,
        ).unavailable;
      });

      if (!refUnavailable) {
        boqRows.forEach((rawItem) => {
          const item = rawItem as unknown as Parameters<typeof calculateLiveCommercialAmounts>[0];
          const categoryName = rawItem.detail_cost_category_id
            ? detailToCategoryName.get(rawItem.detail_cost_category_id) || ''
            : '';
          if (!targetCategories.has(categoryName)) return;

          const live = calculateLiveCommercialAmounts(item, calculationContext);
          if (live.unavailable) return;
          commercialCostByCategory.set(
            categoryName,
            (commercialCostByCategory.get(categoryName) || 0) + live.commercialTotal,
          );
          baseCostByCategory.set(categoryName, (baseCostByCategory.get(categoryName) || 0) + live.baseAmount);
        });
      }

      // 4. Рассчитываем цену за единицу КП
      // Используем коммерческие стоимости, если они заполнены, иначе базовые
      // Если НДС в конструкторе — умножаем стоимость на (1 + НДС%)
      const refVatMultiplier = (isVatInConstructor && vatCoefficient > 0) ? (1 + vatCoefficient / 100) : 1;
      const getCostPerUnit = (categoryName: string): number => {
        const commercial = commercialCostByCategory.get(categoryName) || 0;
        const base = baseCostByCategory.get(categoryName) || 0;
        const cost = (commercial > 0 ? commercial : base) * refVatMultiplier;
        const volume = getCategoryVolume(categoryName);
        return volume > 0 ? cost / volume : 0;
      };

      const monolithPerM3 = getCostPerUnit('МОНОЛИТНЫЕ РАБОТЫ');

      const visPerM2 =
        getCostPerUnit('ВИС / Механические инженерные системы') +
        getCostPerUnit('ВИС / Электрические системы') +
        getCostPerUnit('ВИС / Слаботочные системы, автоматика и диспетчеризация');

      const facadePerM2 = getCostPerUnit('ФАСАДНЫЕ РАБОТЫ');

      setReferenceInfo({ monolithPerM3, visPerM2, facadePerM2 });
    } catch (error) {
      console.error('Ошибка загрузки справочной информации:', error);
    }
  };

  return {
    selectedIndicator,
    setSelectedIndicator,
    breakdownData,
    setBreakdownData,
    loadingBreakdown,
    setLoadingBreakdown,
    referenceInfo,
    fetchCategoryBreakdown,
    fetchReferenceInfo,
  };
};
