import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Typography, Table, Button, Spin } from 'antd';
import { supabase } from '../../../lib/supabase';
import { calculateBoqItemTotalAmount } from '../../../utils/boq/calculateBoqAmount';
import {
  calculateLiveCommercialAmounts,
  loadLiveCommercialCalculationContext,
  resetLiveCommercialCalculationCache,
} from '../../../utils/boq/liveCommercialCalculation';

const { Text, Title } = Typography;
import { Bar, Doughnut } from 'react-chartjs-2';
import { useTheme } from '../../../contexts/ThemeContext';
import type { IndicatorRow } from '../hooks/useFinancialData';

interface IndicatorsChartsProps {
  data: IndicatorRow[];
  spTotal: number;
  formatNumber: (value: number | undefined) => string;
  selectedTenderId: string | null;
  isVatInConstructor: boolean;
  vatCoefficient: number;
}

interface CategoryBreakdown {
  category_name: string;
  detail_name: string;
  location_name: string;
  total_amount: number;
  works_amount: number;
  materials_amount: number;
}

interface DrillDownLevel {
  type: 'root' | 'direct_costs' | 'markups' | 'indicator' | 'profit_breakdown' | 'ooz_breakdown' | 'cost_growth_breakdown' | 'reserve_breakdown';
  indicatorName?: string;
  rowNumber?: number;
}

type TenderRates = {
  usd_rate: number | null;
  eur_rate: number | null;
  cny_rate: number | null;
};

export const IndicatorsCharts: React.FC<IndicatorsChartsProps> = ({
  data,
  spTotal,
  formatNumber,
  selectedTenderId,
  isVatInConstructor,
  vatCoefficient,
}) => {
  const { theme: currentTheme } = useTheme();
  const [selectedIndicator, setSelectedIndicator] = useState<number | null>(null);
  const [breakdownData, setBreakdownData] = useState<CategoryBreakdown[]>([]);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);
  const [drillDownPath, setDrillDownPath] = useState<DrillDownLevel[]>([{ type: 'root' }]);

  // Справочная информация
  const [referenceInfo, setReferenceInfo] = useState<{
    monolithPerM3: number;
    visPerM2: number;
    facadePerM2: number;
  }>({
    monolithPerM3: 0,
    visPerM2: 0,
    facadePerM2: 0,
  });

  const loadTenderRates = async (): Promise<TenderRates> => {
    const { data, error } = await supabase
      .from('tenders')
      .select('usd_rate, eur_rate, cny_rate')
      .eq('id', selectedTenderId)
      .single();

    if (error) throw error;

    return {
      usd_rate: data?.usd_rate || 0,
      eur_rate: data?.eur_rate || 0,
      cny_rate: data?.cny_rate || 0,
    };
  };

  // Рассчитываем общую площадь для отображения (unused, but kept for reference)
  // const totalArea = spTotal + customerTotal;

  // Данные для круговой диаграммы - адаптивные в зависимости от уровня drill-down
  const getCategoriesData = () => {
    const currentLevel = drillDownPath[drillDownPath.length - 1];

    // Уровень 1 (корень): Показываем только "Прямые затраты" и "Наценки"
    if (currentLevel.type === 'root') {
      if (data.length === 0) return null;

      // Фильтруем данные
      const baseData = data.filter(d =>
        !d.is_header &&
        !d.is_total &&
        d.row_number >= 2 &&
        d.row_number <= 15
      );

      // Прямые затраты: строки 2-7 (Субподряд, СУ-10, Запас на сдачу, СМ, МБП+ГСМ, Гарантия)
      // НДС уже включён в total_cost каждой строки (если isVatInConstructor)
      const directCosts = baseData
        .filter(d => d.row_number >= 2 && d.row_number <= 7)
        .reduce((sum, d) => sum + (d.total_cost || 0), 0);

      // Наценки: строки 8-15
      const markups = baseData
        .filter(d => d.row_number >= 8 && d.row_number <= 15)
        .reduce((sum, d) => sum + (d.total_cost || 0), 0);

      // Сортируем по убыванию
      const items = [
        { label: 'Прямые затраты', value: directCosts, color: '#1890ff' },
        { label: 'Наценки', value: markups, color: '#52c41a' },
      ].sort((a, b) => b.value - a.value);

      return {
        labels: items.map(item => item.label),
        datasets: [
          {
            data: items.map(item => item.value),
            backgroundColor: items.map(item => item.color),
            borderWidth: 2,
            borderColor: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
          },
        ],
      };
    }

    // Уровень 2: Детализация прямых затрат
    if (currentLevel.type === 'direct_costs') {
      if (data.length === 0) return null;

      const directCostsData = data.filter(d =>
        !d.is_header &&
        !d.is_total &&
        d.row_number >= 2 &&
        d.row_number <= 7
      );

      const colors = [
        '#ff4d4f', // Субподряд
        '#1890ff', // Работы + Материалы СУ-10
        '#13c2c2', // Запас на сдачу объекта
        '#52c41a', // Служба механизации
        '#faad14', // МБП+ГСМ
        '#722ed1', // Гарантийный период
      ];

      // НДС уже включён в total_cost каждой строки (если isVatInConstructor)
      const items = directCostsData.map((d, idx) => ({
        label: d.indicator_name,
        value: d.total_cost || 0,
        color: colors[idx] || '#1890ff',
        originalIndex: idx,
      }));

      // Сортируем по убыванию стоимости
      items.sort((a, b) => b.value - a.value);

      return {
        labels: items.map(item => item.label),
        datasets: [
          {
            data: items.map(item => item.value),
            backgroundColor: items.map(item => item.color),
            borderWidth: 2,
            borderColor: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
          },
        ],
      };
    }

    // Уровень 2: Детализация наценок
    if (currentLevel.type === 'markups') {
      if (data.length === 0) return null;

      const markupsData = data.filter(d =>
        !d.is_header &&
        !d.is_total &&
        d.row_number >= 8 &&
        d.row_number <= 16
      );

      // Находим строки прибыли и объединяем их
      const profitRow = markupsData.find(d => d.row_number === 14);
      const profitSubRow = markupsData.find(d => d.row_number === 15);

      const combinedProfit = profitRow && profitSubRow ? {
        ...profitRow,
        indicator_name: 'Прибыль',
        total_cost: (profitRow.total_cost || 0) + (profitSubRow.total_cost || 0),
        row_number: 14,
      } : profitRow;

      // Находим строки ООЗ и объединяем их
      const oozRow = markupsData.find(d => d.row_number === 11);
      const oozSubRow = markupsData.find(d => d.row_number === 12);

      const combinedOOZ = oozRow && oozSubRow ? {
        ...oozRow,
        indicator_name: 'ООЗ',
        total_cost: (oozRow.total_cost || 0) + (oozSubRow.total_cost || 0),
        row_number: 11,
      } : oozRow;

      const filteredMarkups = markupsData
        .filter(d => d.row_number !== 15 && d.row_number !== 12) // Исключаем "Прибыль субподряд" и "ООЗ Субподряд"
        .map(d => {
          if (d.row_number === 14) return combinedProfit;
          if (d.row_number === 11) return combinedOOZ;
          return d;
        })
        .filter(d => d && (d.total_cost || 0) !== 0); // Скрываем нулевое страхование

      const colors = [
        '#13c2c2', // 1,6
        '#fa8c16', // Рост стоимости
        '#eb2f96', // Непредвиденные
        '#52c41a', // ООЗ (объединенная)
        '#faad14', // ОФЗ
        '#1890ff', // Прибыль (объединенная)
        '#10b981', // Страхование от судимостей
      ];

      // Создаем массив с цветами и сортируем по убыванию стоимости
      const items = filteredMarkups.map((d, idx) => ({
        label: d!.indicator_name,
        value: d!.total_cost || 0,
        color: colors[idx] || '#1890ff',
        originalData: d,
      })).sort((a, b) => b.value - a.value);

      return {
        labels: items.map(item => item.label),
        datasets: [
          {
            data: items.map(item => item.value),
            backgroundColor: items.map(item => item.color),
            borderWidth: 2,
            borderColor: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
          },
        ],
      };
    }

    // Уровень 2: Показываем drill-down для прибыли
    if (currentLevel.type === 'profit_breakdown') {
      const profitRow = data.find(d => d.row_number === 14);
      const profitSubRow = data.find(d => d.row_number === 15);

      if (profitRow && profitSubRow) {
        // Сортируем по убыванию стоимости
        const items = [
          { label: 'Прибыль', value: profitRow.total_cost || 0, color: '#1890ff' },
          { label: 'Прибыль субподряд', value: profitSubRow.total_cost || 0, color: '#40a9ff' },
        ].sort((a, b) => b.value - a.value);

        return {
          labels: items.map(item => item.label),
          datasets: [
            {
              data: items.map(item => item.value),
              backgroundColor: items.map(item => item.color),
              borderWidth: 2,
              borderColor: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
            },
          ],
        };
      }
    }

    // Уровень 3: Показываем drill-down для ООЗ
    if (currentLevel.type === 'ooz_breakdown') {
      const oozRow = data.find(d => d.row_number === 11);
      const oozSubRow = data.find(d => d.row_number === 12);

      if (oozRow && oozSubRow) {
        // Сортируем по убыванию стоимости
        const items = [
          { label: 'ООЗ', value: oozRow.total_cost || 0, color: '#52c41a' },
          { label: 'ООЗ Субподряд', value: oozSubRow.total_cost || 0, color: '#95de64' },
        ].sort((a, b) => b.value - a.value);

        return {
          labels: items.map(item => item.label),
          datasets: [
            {
              data: items.map(item => item.value),
              backgroundColor: items.map(item => item.color),
              borderWidth: 2,
              borderColor: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
            },
          ],
        };
      }
    }

    // Уровень 3: Показываем drill-down для роста стоимости
    if (currentLevel.type === 'cost_growth_breakdown') {
      // Получаем данные из промежуточных расчетов (не из tooltip)
      const costGrowthRow = data.find(d => d.row_number === 9);

      if (costGrowthRow) {
        // Используем промежуточные значения расчетов
        const worksSu10Growth = costGrowthRow.works_su10_growth || 0;
        const materialsSu10Growth = costGrowthRow.materials_su10_growth || 0;
        const worksSubGrowth = costGrowthRow.works_sub_growth || 0;
        const materialsSubGrowth = costGrowthRow.materials_sub_growth || 0;

        // Сортируем по убыванию стоимости
        const items = [
          { label: 'Рост работ СУ-10', value: worksSu10Growth, color: '#fa8c16' },
          { label: 'Рост материалов СУ-10', value: materialsSu10Growth, color: '#faad14' },
          { label: 'Рост субподрядных работ', value: worksSubGrowth, color: '#ff7a45' },
          { label: 'Рост субподрядных материалов', value: materialsSubGrowth, color: '#ffa940' },
        ].sort((a, b) => b.value - a.value);

        return {
          labels: items.map(item => item.label),
          datasets: [
            {
              data: items.map(item => item.value),
              backgroundColor: items.map(item => item.color),
              borderWidth: 2,
              borderColor: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
            },
          ],
        };
      }
    }

    // Уровень 3: Показываем drill-down для запаса на сдачу объекта (мат-комп. + раб-комп.)
    if (currentLevel.type === 'reserve_breakdown') {
      // Строка 4 содержит общий запас, но нам нужны отдельные значения из боитемов
      // Загружаем их из breakdownData если доступны
      if (breakdownData.length > 0) {
        const colors = [
          '#13c2c2', // Материалы комп.
          '#36cfc9', // Работы комп.
        ];

        // Группируем по типу (материалы/работы)
        const materialsComp = breakdownData
          .filter(item => item.category_name === 'мат-комп.')
          .reduce((sum, item) => sum + item.total_amount, 0);
        const worksComp = breakdownData
          .filter(item => item.category_name === 'раб-комп.')
          .reduce((sum, item) => sum + item.total_amount, 0);

        // Если данные есть, показываем разбивку по типу
        if (materialsComp > 0 || worksComp > 0) {
          const items = [
            { label: 'Запас материалов на сдачу объекта', value: materialsComp, color: colors[0] },
            { label: 'Запас работ на сдачу объекта', value: worksComp, color: colors[1] },
          ].filter(item => item.value > 0).sort((a, b) => b.value - a.value);

          return {
            labels: items.map(item => item.label),
            datasets: [
              {
                data: items.map(item => item.value),
                backgroundColor: items.map(item => item.color),
                borderWidth: 2,
                borderColor: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
              },
            ],
          };
        }
      }
    }

    // Уровень 2: Показываем детализацию по категориям для выбранного индикатора
    if (currentLevel.type === 'indicator') {
      // Если есть загруженные данные breakdown, показываем их
      if (breakdownData.length > 0) {
        const colors = [
          '#ff4d4f', '#1890ff', '#52c41a', '#faad14', '#722ed1',
          '#13c2c2', '#fa8c16', '#eb2f96', '#95de64', '#40a9ff',
          '#f759ab', '#fadb14', '#a0d911', '#36cfc9', '#597ef7',
        ];

        return {
          labels: breakdownData.map(item => item.category_name),
          datasets: [
            {
              data: breakdownData.map(item => item.total_amount),
              backgroundColor: breakdownData.map((_, idx) => colors[idx % colors.length]),
              borderWidth: 2,
              borderColor: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
            },
          ],
        };
      }

      // Проверяем, есть ли детализация для этого показателя
      if (!hasDetailedBreakdown(currentLevel.rowNumber || 0)) {
        // Для показателей без детализации возвращаем null (будет показано сообщение)
        return null;
      }
    }

    return null;
  };

  // Проверка, доступна ли детализация для данного показателя
  const hasDetailedBreakdown = (rowNumber: number): boolean => {
    // Детализация доступна только для показателей, привязанных к boq_items
    // 2 = Субподряд, 3 = Работы+Материалы СУ-10, 4 = Запас на сдачу объекта
    return rowNumber === 2 || rowNumber === 3 || rowNumber === 4;
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

      // Один запрос с вложенной структурой - получаем категорию, вид и локализацию
      const { data: boqItems, error } = await supabase
        .from('boq_items')
        .select(`
          boq_item_type,
          total_amount,
          quantity,
          unit_rate,
          currency_type,
          delivery_price_type,
          delivery_amount,
          consumption_coefficient,
          parent_work_item_id,
          detail_cost_category:detail_cost_categories(
            id,
            name,
            location,
            cost_category:cost_categories(id, name)
          ),
          client_position:client_positions!inner(tender_id)
        `)
        .eq('client_position.tender_id', selectedTenderId)
        .in('boq_item_type', boqItemTypes);

      if (error) throw error;

      if (!boqItems || boqItems.length === 0) {
        setBreakdownData([]);
        return;
      }

      // Группировка по категории + вид + локализация
      const categoryMap = new Map<string, CategoryBreakdown>();

      boqItems.forEach(item => {
        const detailCategory = Array.isArray(item.detail_cost_category) ? item.detail_cost_category[0] : item.detail_cost_category;
        const costCategory = detailCategory?.cost_category;
        const categoryObj = Array.isArray(costCategory) ? costCategory[0] : costCategory;

        const vatMultiplier = (isVatInConstructor && vatCoefficient > 0) ? (1 + vatCoefficient / 100) : 1;
        const amount = calculateBoqItemTotalAmount(item, tenderRates) * vatMultiplier;
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
      // 1. Загружаем detail_cost_categories с именами категорий
      const { data: categories, error: catError } = await supabase
        .from('detail_cost_categories')
        .select('id, cost_categories(name)');

      if (catError) throw catError;

      // Маппинг detail_cost_category_id → cost_category name
      const detailToCategoryName = new Map<string, string>();
      (categories || []).forEach((cat: any) => {
        const name = cat.cost_categories?.name || '';
        if (name) detailToCategoryName.set(cat.id, name);
      });

      // 2. Загружаем ВСЕ объёмы из construction_cost_volumes (и group, и detail)
      const { data: volumes, error: volError } = await supabase
        .from('construction_cost_volumes')
        .select('detail_cost_category_id, group_key, volume')
        .eq('tender_id', selectedTenderId);

      if (volError) throw volError;

      const groupVolumes = new Map<string, number>();
      const detailVolumes = new Map<string, number>();

      (volumes || []).forEach((v: any) => {
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

      // Коммерческие и базовые стоимости по категориям
      const commercialCostByCategory = new Map<string, number>();
      const baseCostByCategory = new Map<string, number>();
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      resetLiveCommercialCalculationCache();

      while (hasMore) {
        const { data, error } = await supabase
          .from('boq_items')
          .select('detail_cost_category_id, total_amount, quantity, unit_rate, currency_type, delivery_price_type, delivery_amount, consumption_coefficient, parent_work_item_id, total_commercial_material_cost, total_commercial_work_cost, client_positions!inner(tender_id)')
          .eq('client_positions.tender_id', selectedTenderId)
          .range(from, from + batchSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          data.forEach((item: any) => {
            const categoryName = detailToCategoryName.get(item.detail_cost_category_id) || '';
            if (!targetCategories.has(categoryName)) return;

            const { commercialTotal, baseAmount } = calculateLiveCommercialAmounts(item, calculationContext);
            commercialCostByCategory.set(categoryName, (commercialCostByCategory.get(categoryName) || 0) + commercialTotal);

            const baseCost = baseAmount;
            baseCostByCategory.set(categoryName, (baseCostByCategory.get(categoryName) || 0) + baseCost);
          });
          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
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

  // Обработчик клика на сегмент круговой диаграммы
  const handlePieClick = async (_event: any, elements: Array<{ index: number }>) => {
    if (elements.length === 0) return;

    const index = elements[0].index;
    const currentLevel = drillDownPath[drillDownPath.length - 1];

    // Уровень 1 (корень): Клик по "Прямые затраты" или "Наценки"
    if (currentLevel.type === 'root') {
      if (index === 0) {
        // Прямые затраты
        setDrillDownPath([
          ...drillDownPath,
          {
            type: 'direct_costs',
            indicatorName: 'Прямые затраты',
          },
        ]);
      } else if (index === 1) {
        // Наценки
        setDrillDownPath([
          ...drillDownPath,
          {
            type: 'markups',
            indicatorName: 'Наценки',
          },
        ]);
      }
      return;
    }

    // Уровень 2: Клик по конкретному индикатору в Прямых затратах
    if (currentLevel.type === 'direct_costs') {
      const directCostsData = data.filter(d =>
        !d.is_header &&
        !d.is_total &&
        d.row_number >= 2 &&
        d.row_number <= 7
      );

      // Строим массив элементов точно так же, как в getCategoriesData
      const items = directCostsData.map((row, idx) => ({
        label: row.indicator_name,
        value: row.total_cost || 0,
        originalIndex: idx,
        rowNumber: row.row_number,
      }));

      // Если НДС в конструкторе, добавляем его как отдельный элемент
      const vatRow = data.find(d => d.row_number === 17);
      if (isVatInConstructor && vatRow && (vatRow.total_cost || 0) > 0) {
        items.push({
          label: 'НДС',
          value: vatRow.total_cost || 0,
          originalIndex: -1, // Специальное значение для НДС
          rowNumber: 17,
        });
      }

      // Сортируем по убыванию стоимости (как в getCategoriesData)
      items.sort((a, b) => b.value - a.value);

      // Получаем нажатый элемент из отсортированного массива
      const clickedItem = items[index];

      // Если нажали на НДС (originalIndex === -1), не делаем ничего
      if (clickedItem && clickedItem.originalIndex === -1) {
        return;
      }

      // Получаем соответствующую строку данных по originalIndex
      const clickedRow = clickedItem ? directCostsData[clickedItem.originalIndex] : null;

      if (clickedRow) {
        setSelectedIndicator(clickedRow.row_number);
        setLoadingBreakdown(true);

        await fetchCategoryBreakdown(clickedRow.row_number);

        setDrillDownPath([
          ...drillDownPath,
          {
            type: 'indicator',
            indicatorName: clickedRow.indicator_name,
            rowNumber: clickedRow.row_number,
          },
        ]);
      }
      return;
    }

    // Уровень 2: Клик по конкретному индикатору в Наценках
    if (currentLevel.type === 'markups') {
      const markupsData = data.filter(d =>
        !d.is_header &&
        !d.is_total &&
        d.row_number >= 8 &&
        d.row_number <= 15
      );

      const profitRow = markupsData.find(d => d.row_number === 14);
      const profitSubRow = markupsData.find(d => d.row_number === 15);
      const combinedProfit = profitRow && profitSubRow ? {
        ...profitRow,
        indicator_name: 'Прибыль',
        total_cost: (profitRow.total_cost || 0) + (profitSubRow.total_cost || 0),
        row_number: 14,
      } : profitRow;

      const oozRow = markupsData.find(d => d.row_number === 11);
      const oozSubRow = markupsData.find(d => d.row_number === 12);
      const combinedOOZ = oozRow && oozSubRow ? {
        ...oozRow,
        indicator_name: 'ООЗ',
        total_cost: (oozRow.total_cost || 0) + (oozSubRow.total_cost || 0),
        row_number: 11,
      } : oozRow;

      const filteredMarkups = markupsData
        .filter(d => d.row_number !== 15 && d.row_number !== 12)
        .map(d => {
          if (d.row_number === 14) return combinedProfit;
          if (d.row_number === 11) return combinedOOZ;
          return d;
        })
        .filter(Boolean);

      // Сортируем массив перед получением кликнутого элемента
      const sortedMarkups = filteredMarkups.map((d, idx) => ({
        data: d!,
        originalIndex: idx,
      })).sort((a, b) => (b.data.total_cost || 0) - (a.data.total_cost || 0));

      const clickedItem = sortedMarkups[index];
      const clickedRow = clickedItem?.data;

      if (clickedRow) {
        // Проверяем, это прибыль?
        if (clickedRow.row_number === 14) {
          // Переходим к drill-down прибыли
          setDrillDownPath([
            ...drillDownPath,
            {
              type: 'profit_breakdown',
              indicatorName: 'Прибыль',
              rowNumber: 14,
            },
          ]);
        } else if (clickedRow.row_number === 11) {
          // Переходим к drill-down ООЗ
          setDrillDownPath([
            ...drillDownPath,
            {
              type: 'ooz_breakdown',
              indicatorName: 'ООЗ',
              rowNumber: 11,
            },
          ]);
        } else if (clickedRow.row_number === 9) {
          // Переходим к drill-down роста стоимости
          setDrillDownPath([
            ...drillDownPath,
            {
              type: 'cost_growth_breakdown',
              indicatorName: 'Рост стоимости',
              rowNumber: 9,
            },
          ]);
        } else {
          // Обычный drill-down для других показателей
          setSelectedIndicator(clickedRow.row_number);
          setLoadingBreakdown(true);

          await fetchCategoryBreakdown(clickedRow.row_number);

          setDrillDownPath([
            ...drillDownPath,
            {
              type: 'indicator',
              indicatorName: clickedRow.indicator_name,
              rowNumber: clickedRow.row_number,
            },
          ]);
        }
      }
    }
  };

  // Функция для возврата на уровень выше
  const handleDrillUp = () => {
    if (drillDownPath.length > 1) {
      const newPath = drillDownPath.slice(0, -1);
      setDrillDownPath(newPath);

      if (newPath.length === 1) {
        // Возвращаемся на корневой уровень
        setSelectedIndicator(null);
        setBreakdownData([]);
      }
    }
  };

  // Сброс выбора при изменении тендера
  useEffect(() => {
    setSelectedIndicator(null);
    setBreakdownData([]);
    setDrillDownPath([{ type: 'root' }]);
  }, [selectedTenderId]);

  useEffect(() => {
    if (!selectedTenderId) {
      return;
    }

    void fetchReferenceInfo();

    if (selectedIndicator && hasDetailedBreakdown(selectedIndicator)) {
      void fetchCategoryBreakdown(selectedIndicator);
    }
    // fetchCategoryBreakdown and fetchReferenceInfo are stable hook-returned functions; excluded to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenderId, selectedIndicator, data, isVatInConstructor, vatCoefficient]);

  // Автоматическая очистка блока детализации при выходе из режима просмотра конечного уровня
  useEffect(() => {
    const currentLevel = drillDownPath[drillDownPath.length - 1];

    // Если текущий уровень не 'indicator', очищаем детализацию
    if (currentLevel.type !== 'indicator') {
      setSelectedIndicator(null);
      setBreakdownData([]);
    }
  }, [drillDownPath]);

  // Данные для столбчатой диаграммы "Стоимость за м²"
  const getAreaBarData = () => {
    if (data.length === 0 || !selectedTenderId) return null;

    const currentLevel = drillDownPath[drillDownPath.length - 1];
    const totalAreaM2 = spTotal; // Используем только площадь по СП

    // Определяем элементы для отображения в зависимости от уровня
    let barItems: { label: string; cost: number; color: string }[] = [];

    if (currentLevel.type === 'root') {
      // Корневой уровень: Прямые затраты и Наценки
      // НДС уже включён в total_cost каждой строки (если isVatInConstructor)
      const directCosts = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 2 && d.row_number <= 7)
        .reduce((sum, d) => sum + (d.total_cost || 0), 0);

      const markups = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 8 && d.row_number <= 15)
        .reduce((sum, d) => sum + (d.total_cost || 0), 0);

      barItems = [
        { label: 'Прямые затраты', cost: directCosts, color: 'rgba(24, 144, 255, 0.6)' },
        { label: 'Наценки', cost: markups, color: 'rgba(82, 196, 26, 0.6)' },
      ].sort((a, b) => b.cost - a.cost); // Сортируем по убыванию стоимости
    } else if (currentLevel.type === 'direct_costs') {
      // Детализация прямых затрат
      const directCostsData = data.filter(d =>
        !d.is_header &&
        !d.is_total &&
        d.row_number >= 2 &&
        d.row_number <= 7
      );

      const colors = [
        'rgba(255, 77, 79, 0.6)',   // Субподряд
        'rgba(24, 144, 255, 0.6)',  // Работы + Материалы СУ-10
        'rgba(82, 196, 26, 0.6)',   // Служба механизации
        'rgba(250, 173, 20, 0.6)',  // МБП+ГСМ
        'rgba(114, 46, 209, 0.6)',  // Гарантийный период
      ];

      // НДС уже включён в total_cost каждой строки (если isVatInConstructor)
      barItems = directCostsData.map((d, idx) => ({
        label: d.indicator_name,
        cost: d.total_cost || 0,
        color: colors[idx] || 'rgba(24, 144, 255, 0.6)',
      }));

      barItems.sort((a, b) => b.cost - a.cost); // Сортируем по убыванию стоимости
    } else if (currentLevel.type === 'markups') {
      // Детализация наценок
      const markupsData = data.filter(d =>
        !d.is_header &&
        !d.is_total &&
        d.row_number >= 8 &&
        d.row_number <= 16
      );

      // Объединяем строки прибыли
      const profitRow = markupsData.find(d => d.row_number === 14);
      const profitSubRow = markupsData.find(d => d.row_number === 15);
      const combinedProfit = profitRow && profitSubRow ? {
        ...profitRow,
        indicator_name: 'Прибыль',
        total_cost: (profitRow.total_cost || 0) + (profitSubRow.total_cost || 0),
      } : profitRow;

      // Объединяем строки ООЗ
      const oozRow = markupsData.find(d => d.row_number === 11);
      const oozSubRow = markupsData.find(d => d.row_number === 12);
      const combinedOOZ = oozRow && oozSubRow ? {
        ...oozRow,
        indicator_name: 'ООЗ',
        total_cost: (oozRow.total_cost || 0) + (oozSubRow.total_cost || 0),
      } : oozRow;

      const filteredMarkups = markupsData
        .filter(d => d.row_number !== 15 && d.row_number !== 12)
        .map(d => {
          if (d.row_number === 14) return combinedProfit;
          if (d.row_number === 11) return combinedOOZ;
          return d;
        })
        .filter(d => d && (d.total_cost || 0) !== 0); // Скрываем нулевое страхование

      const colors = [
        'rgba(19, 194, 194, 0.6)',  // 1,6
        'rgba(250, 140, 22, 0.6)',  // Рост стоимости
        'rgba(235, 47, 150, 0.6)',  // Непредвиденные
        'rgba(82, 196, 26, 0.6)',   // ООЗ (объединенная)
        'rgba(250, 173, 20, 0.6)',  // ОФЗ
        'rgba(24, 144, 255, 0.6)',  // Прибыль (объединенная)
        'rgba(16, 185, 129, 0.6)',  // Страхование от судимостей
      ];

      barItems = filteredMarkups.map((d, idx) => ({
        label: d!.indicator_name,
        cost: d!.total_cost || 0,
        color: colors[idx] || 'rgba(24, 144, 255, 0.6)',
      })).sort((a, b) => b.cost - a.cost); // Сортируем по убыванию стоимости
    } else if (currentLevel.type === 'indicator' && breakdownData.length > 0) {
      // Детализация по категориям затрат для конкретного индикатора
      // Группируем данные только по категориям (без видов и локализаций)
      const categoryMap = new Map<string, number>();
      breakdownData.forEach(item => {
        const current = categoryMap.get(item.category_name) || 0;
        categoryMap.set(item.category_name, current + item.total_amount);
      });

      const colors = [
        'rgba(255, 77, 79, 0.6)',     // #ff4d4f
        'rgba(24, 144, 255, 0.6)',    // #1890ff
        'rgba(82, 196, 26, 0.6)',     // #52c41a
        'rgba(250, 173, 20, 0.6)',    // #faad14
        'rgba(114, 46, 209, 0.6)',    // #722ed1
        'rgba(19, 194, 194, 0.6)',    // #13c2c2
        'rgba(250, 140, 22, 0.6)',    // #fa8c16
        'rgba(235, 47, 150, 0.6)',    // #eb2f96
        'rgba(149, 222, 100, 0.6)',   // #95de64
        'rgba(64, 169, 255, 0.6)',    // #40a9ff
        'rgba(247, 89, 171, 0.6)',    // #f759ab
        'rgba(250, 219, 20, 0.6)',    // #fadb14
        'rgba(160, 217, 17, 0.6)',    // #a0d911
        'rgba(54, 207, 201, 0.6)',    // #36cfc9
        'rgba(89, 126, 247, 0.6)',    // #597ef7
      ];

      barItems = Array.from(categoryMap.entries()).map(([categoryName, totalCost], idx) => ({
        label: categoryName,
        cost: totalCost,
        color: colors[idx % colors.length],
      })).sort((a, b) => b.cost - a.cost);
    } else if (currentLevel.type === 'indicator' && selectedIndicator) {
      // Конкретный показатель - один столбец (только если нет breakdown данных)
      const indicator = data.find(d => d.row_number === selectedIndicator);
      if (indicator) {
        barItems = [{
          label: indicator.indicator_name,
          cost: indicator.total_cost || 0,
          color: 'rgba(24, 144, 255, 0.6)',
        }];
      }
    } else if (currentLevel.type === 'profit_breakdown') {
      // Детализация прибыли
      const profitItems = data.filter(d => d.row_number === 14 || d.row_number === 15);
      barItems = profitItems.map((d, idx) => ({
        label: d.indicator_name,
        cost: d.total_cost || 0,
        color: idx === 0 ? 'rgba(24, 144, 255, 0.6)' : 'rgba(64, 169, 255, 0.6)',
      })).sort((a, b) => b.cost - a.cost); // Сортируем по убыванию стоимости
    } else if (currentLevel.type === 'ooz_breakdown') {
      // Детализация ООЗ
      const oozItems = data.filter(d => d.row_number === 11 || d.row_number === 12);
      barItems = oozItems.map((d, idx) => ({
        label: d.indicator_name,
        cost: d.total_cost || 0,
        color: idx === 0 ? 'rgba(82, 196, 26, 0.6)' : 'rgba(149, 222, 100, 0.6)',
      })).sort((a, b) => b.cost - a.cost); // Сортируем по убыванию стоимости
    } else if (currentLevel.type === 'cost_growth_breakdown') {
      // Детализация роста стоимости
      const costGrowthRow = data.find(d => d.row_number === 9);

      if (costGrowthRow) {
        // Используем промежуточные значения расчетов
        const worksSu10Growth = costGrowthRow.works_su10_growth || 0;
        const materialsSu10Growth = costGrowthRow.materials_su10_growth || 0;
        const worksSubGrowth = costGrowthRow.works_sub_growth || 0;
        const materialsSubGrowth = costGrowthRow.materials_sub_growth || 0;

        barItems = [
          { label: 'Рост работ СУ-10', cost: worksSu10Growth, color: 'rgba(250, 140, 22, 0.6)' },
          { label: 'Рост материалов СУ-10', cost: materialsSu10Growth, color: 'rgba(250, 173, 20, 0.6)' },
          { label: 'Рост субподрядных работ', cost: worksSubGrowth, color: 'rgba(255, 122, 69, 0.6)' },
          { label: 'Рост субподрядных материалов', cost: materialsSubGrowth, color: 'rgba(255, 169, 64, 0.6)' },
        ].sort((a, b) => b.cost - a.cost); // Сортируем по убыванию стоимости
      }
    }

    // Конвертируем в стоимость за м²
    const pricePerM2Items = barItems.map(item => ({
      label: item.label,
      pricePerM2: totalAreaM2 > 0 ? item.cost / totalAreaM2 : 0,
      color: item.color,
    }));

    return {
      labels: pricePerM2Items.map(item => item.label),
      datasets: [
        {
          label: 'Стоимость за м² (руб.)',
          data: pricePerM2Items.map(item => Math.round(item.pricePerM2)),
          backgroundColor: pricePerM2Items.map(item => item.color),
          borderColor: pricePerM2Items.map(item => item.color.replace('0.6', '1')),
          borderWidth: 1,
        },
      ],
    };
  };

  // Колонки таблицы детализации по категориям затрат
  const breakdownColumns = [
    {
      title: '№',
      dataIndex: 'key',
      key: 'key',
      width: 50,
      render: (_: any, __: any, index: number) => index + 1,
    },
    {
      title: 'Категория затрат',
      dataIndex: 'category_name',
      key: 'category_name',
      width: 200,
    },
    {
      title: 'Вид затрат',
      dataIndex: 'detail_name',
      key: 'detail_name',
      width: 200,
    },
    {
      title: 'Локализация',
      dataIndex: 'location_name',
      key: 'location_name',
      width: 150,
    },
    {
      title: 'Работы (руб.)',
      dataIndex: 'works_amount',
      key: 'works_amount',
      width: 150,
      align: 'right' as const,
      render: (val: number) => formatNumber(val),
    },
    {
      title: 'Материалы (руб.)',
      dataIndex: 'materials_amount',
      key: 'materials_amount',
      width: 150,
      align: 'right' as const,
      render: (val: number) => formatNumber(val),
    },
    {
      title: 'Итого (руб.)',
      dataIndex: 'total_amount',
      key: 'total_amount',
      width: 150,
      align: 'right' as const,
      render: (val: number) => <Text strong>{formatNumber(val)}</Text>,
    },
  ];

  // Получаем данные для таблицы детализации в зависимости от текущего уровня drill-down
  const getSummaryTableData = () => {
    const currentLevel = drillDownPath[drillDownPath.length - 1];
    const totalAreaM2 = spTotal; // Используем только площадь по СП

    if (currentLevel.type === 'root') {
      // Корневой уровень: показываем Прямые затраты и Наценки
      // НДС уже включён в total_cost каждой строки (если isVatInConstructor)
      const directCosts = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 2 && d.row_number <= 7)
        .reduce((sum, d) => sum + (d.total_cost || 0), 0);

      const markups = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 8 && d.row_number <= 15)
        .reduce((sum, d) => sum + (d.total_cost || 0), 0);

      return [
        {
          key: 0,
          indicator_name: 'Прямые затраты',
          amount: directCosts,
          price_per_m2: totalAreaM2 > 0 ? directCosts / totalAreaM2 : 0,
        },
        {
          key: 1,
          indicator_name: 'Наценки',
          amount: markups,
          price_per_m2: totalAreaM2 > 0 ? markups / totalAreaM2 : 0,
        },
      ].sort((a, b) => b.amount - a.amount);
    } else if (currentLevel.type === 'direct_costs') {
      // Детализация прямых затрат
      const items = data
        .filter(d => !d.is_header && !d.is_total && d.row_number >= 2 && d.row_number <= 7)
        .map((d, idx) => ({
          key: idx,
          indicator_name: d.indicator_name,
          amount: d.total_cost || 0,
          price_per_m2: totalAreaM2 > 0 ? (d.total_cost || 0) / totalAreaM2 : 0,
        }));

      // НДС уже включён в total_cost каждой строки (если isVatInConstructor)
      return items.sort((a, b) => b.amount - a.amount);
    } else if (currentLevel.type === 'markups') {
      // Детализация наценок
      const markupsData = data.filter(d =>
        !d.is_header &&
        !d.is_total &&
        d.row_number >= 8 &&
        d.row_number <= 16
      );

      // Объединяем строки прибыли
      const profitRow = markupsData.find(d => d.row_number === 14);
      const profitSubRow = markupsData.find(d => d.row_number === 15);
      const combinedProfit = profitRow && profitSubRow ? {
        ...profitRow,
        indicator_name: 'Прибыль',
        total_cost: (profitRow.total_cost || 0) + (profitSubRow.total_cost || 0),
      } : profitRow;

      // Объединяем строки ООЗ
      const oozRow = markupsData.find(d => d.row_number === 11);
      const oozSubRow = markupsData.find(d => d.row_number === 12);
      const combinedOOZ = oozRow && oozSubRow ? {
        ...oozRow,
        indicator_name: 'ООЗ',
        total_cost: (oozRow.total_cost || 0) + (oozSubRow.total_cost || 0),
      } : oozRow;

      const filteredMarkups = markupsData
        .filter(d => d.row_number !== 15 && d.row_number !== 12)
        .map(d => {
          if (d.row_number === 14) return combinedProfit;
          if (d.row_number === 11) return combinedOOZ;
          return d;
        })
        .filter(d => d && (d.total_cost || 0) !== 0); // Скрываем нулевое страхование

      return filteredMarkups.map((d, idx) => ({
        key: idx,
        indicator_name: d!.indicator_name,
        amount: d!.total_cost || 0,
        price_per_m2: totalAreaM2 > 0 ? (d!.total_cost || 0) / totalAreaM2 : 0,
      })).sort((a, b) => b.amount - a.amount);
    } else if (currentLevel.type === 'profit_breakdown') {
      // Детализация прибыли
      const profitItems = data.filter(d => d.row_number === 14 || d.row_number === 15);
      return profitItems.map((d, idx) => ({
        key: idx,
        indicator_name: d.indicator_name,
        amount: d.total_cost || 0,
        price_per_m2: totalAreaM2 > 0 ? (d.total_cost || 0) / totalAreaM2 : 0,
      })).sort((a, b) => b.amount - a.amount);
    } else if (currentLevel.type === 'ooz_breakdown') {
      // Детализация ООЗ
      const oozItems = data.filter(d => d.row_number === 11 || d.row_number === 12);
      return oozItems.map((d, idx) => ({
        key: idx,
        indicator_name: d.indicator_name,
        amount: d.total_cost || 0,
        price_per_m2: totalAreaM2 > 0 ? (d.total_cost || 0) / totalAreaM2 : 0,
      })).sort((a, b) => b.amount - a.amount);
    } else if (currentLevel.type === 'cost_growth_breakdown') {
      // Детализация роста стоимости
      const costGrowthRow = data.find(d => d.row_number === 9);

      if (costGrowthRow) {
        // Используем промежуточные значения расчетов
        const worksSu10Growth = costGrowthRow.works_su10_growth || 0;
        const materialsSu10Growth = costGrowthRow.materials_su10_growth || 0;
        const worksSubGrowth = costGrowthRow.works_sub_growth || 0;
        const materialsSubGrowth = costGrowthRow.materials_sub_growth || 0;

        return [
          { key: 0, indicator_name: 'Рост работ СУ-10', amount: worksSu10Growth, price_per_m2: totalAreaM2 > 0 ? worksSu10Growth / totalAreaM2 : 0 },
          { key: 1, indicator_name: 'Рост материалов СУ-10', amount: materialsSu10Growth, price_per_m2: totalAreaM2 > 0 ? materialsSu10Growth / totalAreaM2 : 0 },
          { key: 2, indicator_name: 'Рост субподрядных работ', amount: worksSubGrowth, price_per_m2: totalAreaM2 > 0 ? worksSubGrowth / totalAreaM2 : 0 },
          { key: 3, indicator_name: 'Рост субподрядных материалов', amount: materialsSubGrowth, price_per_m2: totalAreaM2 > 0 ? materialsSubGrowth / totalAreaM2 : 0 },
        ].sort((a, b) => b.amount - a.amount);
      }
    }

    return [];
  };

  const summaryTableColumns = [
    {
      title: '№',
      dataIndex: 'key',
      key: 'key',
      width: 50,
      render: (_: any, __: any, index: number) => index + 1,
    },
    {
      title: 'Показатель',
      dataIndex: 'indicator_name',
      key: 'indicator_name',
      width: 300,
    },
    {
      title: 'Сумма (руб.)',
      dataIndex: 'amount',
      key: 'amount',
      width: 150,
      align: 'right' as const,
      render: (val: number) => <Text strong>{formatNumber(val)}</Text>,
    },
    {
      title: 'Цена за м² (руб./м²)',
      dataIndex: 'price_per_m2',
      key: 'price_per_m2',
      width: 150,
      align: 'right' as const,
      render: (val: number) => <Text>{formatNumber(Math.round(val))}</Text>,
    },
  ];

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: handlePieClick,
    layout: {
      padding: {
        top: 10,
        right: 10,
        bottom: 10,
        left: 10,
      },
    },
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          color: currentTheme === 'dark' ? '#ffffff' : '#000000',
          padding: 6,
          font: { size: 10 },
          boxWidth: 12,
          boxHeight: 12,
          generateLabels: function(chart: any) {
            const currentLevel = drillDownPath[drillDownPath.length - 1];

            type LegendItem = {
              text: string;
              fillStyle: string;
              strokeStyle?: string;
              lineWidth?: number;
              hidden: boolean;
              index: number;
              fontColor?: string;
              fontStyle?: string;
            };
            // Для уровня 2 (direct_costs или markups) добавляем разделители
            if (currentLevel.type === 'direct_costs') {
              const labels: LegendItem[] = [];

              // Добавляем заголовок "Прямые затраты, в том числе:"
              labels.push({
                text: 'Прямые затраты, в том числе:',
                fillStyle: 'transparent',
                strokeStyle: 'transparent',
                lineWidth: 0,
                hidden: false,
                index: -1,
                fontColor: currentTheme === 'dark' ? '#ffffff' : '#000000',
                fontStyle: 'bold',
              });

              // Добавляем все элементы прямых затрат с процентами
              const total = chart.data.datasets[0].data.reduce((a: number, b: number) => a + b, 0);
              chart.data.labels.forEach((label: string, i: number) => {
                const value = chart.data.datasets[0].data[i];
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                labels.push({
                  text: `${label} (${percentage}%)`,
                  fillStyle: chart.data.datasets[0].backgroundColor[i],
                  hidden: false,
                  index: i,
                  fontColor: currentTheme === 'dark' ? '#ffffff' : '#000000',
                });
              });

              return labels;
            }

            if (currentLevel.type === 'markups') {
              const labels: LegendItem[] = [];

              // Добавляем заголовок "Наценки, в том числе:"
              labels.push({
                text: 'Наценки, в том числе:',
                fillStyle: 'transparent',
                strokeStyle: 'transparent',
                lineWidth: 0,
                hidden: false,
                index: -1,
                fontColor: currentTheme === 'dark' ? '#ffffff' : '#000000',
                fontStyle: 'bold',
              });

              // Добавляем все элементы наценок с процентами
              const totalMarkups = chart.data.datasets[0].data.reduce((a: number, b: number) => a + b, 0);
              chart.data.labels.forEach((label: string, i: number) => {
                const value = chart.data.datasets[0].data[i];
                const percentage = totalMarkups > 0 ? ((value / totalMarkups) * 100).toFixed(1) : '0.0';
                labels.push({
                  text: `${label} (${percentage}%)`,
                  fillStyle: chart.data.datasets[0].backgroundColor[i],
                  hidden: false,
                  index: i,
                  fontColor: currentTheme === 'dark' ? '#ffffff' : '#000000',
                });
              });

              return labels;
            }

            // Для всех остальных уровней (root, indicator, profit_breakdown) - стандартные метки с процентами
            const total = chart.data.datasets[0].data.reduce((a: number, b: number) => a + b, 0);
            return chart.data.labels.map((label: string, i: number) => {
              const value = chart.data.datasets[0].data[i];
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
              return {
                text: `${label} (${percentage}%)`,
                fillStyle: chart.data.datasets[0].backgroundColor[i],
                hidden: false,
                index: i,
                fontColor: currentTheme === 'dark' ? '#ffffff' : '#000000',
              };
            });
          },
        },
        maxWidth: 200,
        onClick: function(e: any, legendItem: any, legend: any) {
          // Игнорируем клики на заголовки и разделители
          if (legendItem.index < 0) return;

          // Стандартное поведение для остальных элементов
          const index = legendItem.index;
          const chart = legend.chart;

          // Вызываем handlePieClick программно
          const elements = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
          if (elements.length === 0) {
            // Создаем псевдо-элемент для handlePieClick
            handlePieClick(e, [{ index }]);
          }
        },
      },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            const label = context.label || '';
            const value = context.parsed || 0;
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            return `${label}: ${value.toLocaleString('ru-RU')} руб. (${percentage}%)`;
          }
        }
      },
      datalabels: { display: false },
    },
  };

  // Обработчик клика по столбцу в барной диаграмме
  const handleBarClick = async (_event: any, elements: any) => {
    if (elements.length === 0) return;

    const clickedIndex = elements[0].index;
    const currentLevel = drillDownPath[drillDownPath.length - 1];

    // На корневом уровне
    if (currentLevel.type === 'root') {
      const labels = ['Прямые затраты', 'Наценки'];
      const clickedLabel = labels[clickedIndex];

      if (clickedLabel === 'Прямые затраты') {
        setDrillDownPath([...drillDownPath, { type: 'direct_costs' }]);
      } else if (clickedLabel === 'Наценки') {
        setDrillDownPath([...drillDownPath, { type: 'markups' }]);
      }
    }
    // На уровне прямых затрат - переходим к конкретному показателю
    else if (currentLevel.type === 'direct_costs') {
      const directCostsData = data.filter(d =>
        !d.is_header &&
        !d.is_total &&
        d.row_number >= 2 &&
        d.row_number <= 7
      );

      if (clickedIndex < directCostsData.length) {
        const clickedRow = directCostsData[clickedIndex];
        setSelectedIndicator(clickedRow.row_number);
        setLoadingBreakdown(true);

        await fetchCategoryBreakdown(clickedRow.row_number);

        setDrillDownPath([
          ...drillDownPath,
          {
            type: 'indicator',
            indicatorName: clickedRow.indicator_name,
            rowNumber: clickedRow.row_number,
          },
        ]);
      }
    }
    // На уровне наценок
    else if (currentLevel.type === 'markups') {
      const markupsData = data.filter(d =>
        !d.is_header &&
        !d.is_total &&
        d.row_number >= 8 &&
        d.row_number <= 15
      );

      // Объединяем строки прибыли
      const profitRow = markupsData.find(d => d.row_number === 14);
      const profitSubRow = markupsData.find(d => d.row_number === 15);
      const combinedProfit = profitRow && profitSubRow ? {
        ...profitRow,
        indicator_name: 'Прибыль',
        total_cost: (profitRow.total_cost || 0) + (profitSubRow.total_cost || 0),
        row_number: 14,
      } : profitRow;

      // Объединяем строки ООЗ
      const oozRow = markupsData.find(d => d.row_number === 11);
      const oozSubRow = markupsData.find(d => d.row_number === 12);
      const combinedOOZ = oozRow && oozSubRow ? {
        ...oozRow,
        indicator_name: 'ООЗ',
        total_cost: (oozRow.total_cost || 0) + (oozSubRow.total_cost || 0),
        row_number: 11,
      } : oozRow;

      const filteredMarkups = markupsData
        .filter(d => d.row_number !== 15 && d.row_number !== 12) // Исключаем "Прибыль субподряд" и "ООЗ Субподряд"
        .map(d => {
          if (d.row_number === 14) return combinedProfit;
          if (d.row_number === 11) return combinedOOZ;
          return d;
        })
        .filter(Boolean);

      // Сортируем массив перед получением кликнутого элемента
      const sortedMarkups = filteredMarkups.map((d, idx) => ({
        data: d!,
        originalIndex: idx,
      })).sort((a, b) => (b.data.total_cost || 0) - (a.data.total_cost || 0));

      const clickedItem = sortedMarkups[clickedIndex];
      const clickedRow = clickedItem?.data;

      if (clickedRow) {
        // Проверяем, это прибыль?
        if (clickedRow.row_number === 14) {
          setDrillDownPath([
            ...drillDownPath,
            {
              type: 'profit_breakdown',
              indicatorName: 'Прибыль',
              rowNumber: 14,
            },
          ]);
        } else if (clickedRow.row_number === 11) {
          // Переходим к drill-down ООЗ
          setDrillDownPath([
            ...drillDownPath,
            {
              type: 'ooz_breakdown',
              indicatorName: 'ООЗ',
              rowNumber: 11,
            },
          ]);
        } else if (clickedRow.row_number === 9) {
          // Переходим к drill-down роста стоимости
          setDrillDownPath([
            ...drillDownPath,
            {
              type: 'cost_growth_breakdown',
              indicatorName: 'Рост стоимости',
              rowNumber: 9,
            },
          ]);
        } else {
          // Обычный drill-down для других показателей
          setSelectedIndicator(clickedRow.row_number);
          setLoadingBreakdown(true);

          await fetchCategoryBreakdown(clickedRow.row_number);

          setDrillDownPath([
            ...drillDownPath,
            {
              type: 'indicator',
              indicatorName: clickedRow.indicator_name,
              rowNumber: clickedRow.row_number,
            },
          ]);
        }
      }
    }
  };

  // Extract current drill-down level for use in barOptions
  const currentLevel = drillDownPath[drillDownPath.length - 1];

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: handleBarClick,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: currentTheme === 'dark' ? '#ffffff' : '#000000',
          font: { size: 12 },
        },
      },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            const value = context.parsed.y || 0;
            return `Стоимость за м²: ${value.toLocaleString('ru-RU')} руб.`;
          }
        }
      },
      datalabels: { display: false },
    },
    scales: {
      y: {
        ticks: {
          color: currentTheme === 'dark' ? '#ffffff' : '#000000',
        },
        grid: {
          color: currentTheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
        },
      },
      x: {
        ticks: {
          color: currentTheme === 'dark' ? '#ffffff' : '#000000',
          font: {
            size: currentLevel.type === 'indicator' && breakdownData.length > 0 ? 10 : 12
          },
          maxRotation: currentLevel.type === 'indicator' && breakdownData.length > 0 ? 0 : 0,
          minRotation: 0,
          autoSkip: false,
          callback: function(value: any) {
            const label = this.getLabelForValue(value);
            const maxLen = currentLevel.type === 'markups' ? 14 : 20;
            // Разбиваем длинные метки на несколько строк
            if (
              (currentLevel.type === 'indicator' && breakdownData.length > 0) ||
              currentLevel.type === 'markups'
            ) {
              if (label.length > maxLen) {
                const words = label.split(' ');
                const lines: string[] = [];
                let currentLine = '';
                words.forEach((word: string) => {
                  if ((currentLine + ' ' + word).length > maxLen && currentLine.length > 0) {
                    lines.push(currentLine);
                    currentLine = word;
                  } else {
                    currentLine = currentLine ? currentLine + ' ' + word : word;
                  }
                });
                if (currentLine) lines.push(currentLine);
                return lines;
              }
            }
            return label;
          }
        },
        grid: {
          color: currentTheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
        },
      },
    },
  };

  // Получаем имя выбранного индикатора
  const selectedIndicatorName = selectedIndicator
    ? data.find(d => d.row_number === selectedIndicator)?.indicator_name
    : null;

  return (
    <div>
      {/* Верхний ряд: Круговая диаграмма и столбчатая диаграмма */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <Card
            bordered
            style={{
              height: 450,
              background: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Title level={5} style={{ margin: 0, color: currentTheme === 'dark' ? '#ffffff' : '#000000' }}>
                  Структура Цены
                </Title>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {data.length > 0 && (
                    <Text strong style={{ fontSize: 16, color: currentTheme === 'dark' ? '#ffffff' : '#000000' }}>
                      {formatNumber(
                        drillDownPath.length === 1
                          ? data.find(d => d.is_total)?.total_cost
                          : drillDownPath[drillDownPath.length - 1].type === 'direct_costs'
                          ? data.filter(d => !d.is_header && !d.is_total && d.row_number >= 2 && d.row_number <= 7).reduce((sum, d) => sum + (d.total_cost || 0), 0)
                          : drillDownPath[drillDownPath.length - 1].type === 'markups'
                          ? data.filter(d => !d.is_header && !d.is_total && d.row_number >= 8 && d.row_number <= 15).reduce((sum, d) => sum + (d.total_cost || 0), 0)
                          : drillDownPath[drillDownPath.length - 1].type === 'indicator' && selectedIndicator
                          ? data.find(d => d.row_number === selectedIndicator)?.total_cost
                          : drillDownPath[drillDownPath.length - 1].type === 'profit_breakdown'
                          ? data.filter(d => d.row_number === 14 || d.row_number === 15).reduce((sum, d) => sum + (d.total_cost || 0), 0)
                          : data.find(d => d.is_total)?.total_cost
                      )} Руб.
                    </Text>
                  )}
                  {drillDownPath.length > 1 && (
                    <Button
                      size="small"
                      style={{ backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
                      onClick={handleDrillUp}
                    >
                      ← Назад
                    </Button>
                  )}
                </div>
              </div>

              {/* Breadcrumb навигация */}
              {drillDownPath.length > 1 && (
                <div style={{ marginBottom: 8 }}>
                  {drillDownPath.map((level, idx) => (
                    <span key={idx}>
                      {idx > 0 && <Text type="secondary"> → </Text>}
                      <Text
                        type={idx === drillDownPath.length - 1 ? undefined : 'secondary'}
                        style={{
                          cursor: idx < drillDownPath.length - 1 ? 'pointer' : 'default',
                          fontWeight: idx === drillDownPath.length - 1 ? 600 : 400,
                          color: idx === drillDownPath.length - 1 ? '#1890ff' : undefined,
                        }}
                        onClick={() => {
                          if (idx < drillDownPath.length - 1) {
                            setDrillDownPath(drillDownPath.slice(0, idx + 1));
                            if (idx === 0) {
                              setSelectedIndicator(null);
                              setBreakdownData([]);
                            }
                          }
                        }}
                      >
                        {level.type === 'root'
                          ? 'Все показатели'
                          : level.type === 'direct_costs'
                          ? 'Прямые затраты'
                          : level.type === 'markups'
                          ? 'Наценки'
                          : level.type === 'profit_breakdown'
                          ? 'Детализация прибыли'
                          : level.type === 'reserve_breakdown'
                          ? 'Запас на сдачу объекта'
                          : level.indicatorName || 'Детализация'}
                      </Text>
                    </span>
                  ))}
                </div>
              )}

              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {drillDownPath.length === 1
                    ? 'Кликните для детализации'
                    : drillDownPath[drillDownPath.length - 1].type === 'indicator'
                    ? 'Детализация по категориям затрат'
                    : 'Детализация по показателям'}
                </Text>
              </div>
            </div>
            <Spin spinning={loadingBreakdown}>
              {getCategoriesData() ? (
                <div style={{ height: 320, maxHeight: 320, overflow: 'hidden' }}>
                  <Doughnut data={getCategoriesData()!} options={pieOptions} />
                </div>
              ) : drillDownPath.length > 1 ? (
                <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                  <Text type="secondary" style={{ fontSize: 16, marginBottom: 12 }}>
                    📊 Детализация недоступна
                  </Text>
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    Для показателя "{drillDownPath[drillDownPath.length - 1].indicatorName}"
                  </Text>
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    детализация по категориям затрат не предусмотрена
                  </Text>
                  <Button type="primary" onClick={handleDrillUp} style={{ marginTop: 16 }}>
                    Вернуться к общему обзору
                  </Button>
                </div>
              ) : null}
            </Spin>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            bordered
            style={{
              height: 450,
              background: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Title level={5} style={{ margin: 0, color: currentTheme === 'dark' ? '#ffffff' : '#000000' }}>
                  Стоимость за м²
                </Title>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {data.length > 0 && (
                    <Text strong style={{ fontSize: 16, color: currentTheme === 'dark' ? '#ffffff' : '#000000' }}>
                      {(() => {
                        const currentLevel = drillDownPath[drillDownPath.length - 1];
                        const totalAreaM2 = spTotal; // Используем только площадь по СП
                        let currentCost = 0;

                        if (currentLevel.type === 'root') {
                          currentCost = data.find(d => d.is_total)?.total_cost || 0;
                        } else if (currentLevel.type === 'direct_costs') {
                          currentCost = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 2 && d.row_number <= 7)
                            .reduce((sum, d) => sum + (d.total_cost || 0), 0);
                        } else if (currentLevel.type === 'markups') {
                          currentCost = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 8 && d.row_number <= 15)
                            .reduce((sum, d) => sum + (d.total_cost || 0), 0);
                        } else if (currentLevel.type === 'indicator' && selectedIndicator) {
                          currentCost = data.find(d => d.row_number === selectedIndicator)?.total_cost || 0;
                        } else if (currentLevel.type === 'profit_breakdown') {
                          currentCost = data.filter(d => d.row_number === 14 || d.row_number === 15)
                            .reduce((sum, d) => sum + (d.total_cost || 0), 0);
                        }

                        const pricePerM2 = totalAreaM2 > 0 ? currentCost / totalAreaM2 : 0;
                        return `${formatNumber(Math.round(pricePerM2))} Руб./м²`;
                      })()}
                    </Text>
                  )}
                  {drillDownPath.length > 1 && (
                    <Button
                      size="small"
                      style={{ backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
                      onClick={handleDrillUp}
                    >
                      ← Назад
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {getAreaBarData() && (
              <div style={{ height: 350 }}>
                <Bar data={getAreaBarData()!} options={barOptions} />
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* Детализация по категориям затрат (показывается только для Субподряда и Работы+Материалы СУ-10) */}
      {selectedIndicator && (selectedIndicator === 2 || selectedIndicator === 3 || selectedIndicator === 4) && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24}>
            <Card
              bordered
              style={{
                background: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
              }}
            >
              <div style={{ marginBottom: 16 }}>
                <Title level={5} style={{ margin: 0, marginBottom: 4 }}>
                  Детализация по категориям затрат
                </Title>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {selectedIndicatorName}
                </Text>
              </div>

              <Spin spinning={loadingBreakdown}>
                <Table
                  dataSource={breakdownData}
                  columns={breakdownColumns}
                  pagination={false}
                  size="small"
                  bordered
                  scroll={{ x: 1200 }}
                  summary={(data) => {
                    const totalWorks = data.reduce((sum, item) => sum + item.works_amount, 0);
                    const totalMaterials = data.reduce((sum, item) => sum + item.materials_amount, 0);
                    const total = data.reduce((sum, item) => sum + item.total_amount, 0);

                    return (
                      <Table.Summary.Row style={{ background: currentTheme === 'dark' ? '#262626' : '#fafafa' }}>
                        <Table.Summary.Cell index={0} colSpan={4}>
                          <Text strong>ИТОГО:</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right">
                          <Text strong>{formatNumber(totalWorks)}</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right">
                          <Text strong>{formatNumber(totalMaterials)}</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="right">
                          <Text strong style={{ color: '#1890ff' }}>{formatNumber(total)}</Text>
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    );
                  }}
                />
              </Spin>
            </Card>
          </Col>
        </Row>
      )}

      {/* Нижний ряд: Таблица сводки по выбранному уровню (скрыт когда открыт блок детализации затрат) */}
      {!(selectedIndicator && (selectedIndicator === 2 || selectedIndicator === 3 || selectedIndicator === 4)) && (
        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card
              bordered
              style={{
                background: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
              }}
            >
              <div style={{ marginBottom: 16 }}>
                <Title level={5} style={{ margin: 0, marginBottom: 4 }}>
                  Краткая сводка
                </Title>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {drillDownPath.length === 1
                  ? 'Общая структура затрат'
                  : drillDownPath[drillDownPath.length - 1].type === 'direct_costs'
                  ? 'Состав прямых затрат'
                  : drillDownPath[drillDownPath.length - 1].type === 'markups'
                  ? 'Состав наценок'
                  : drillDownPath[drillDownPath.length - 1].type === 'profit_breakdown'
                  ? 'Детализация прибыли'
                  : drillDownPath[drillDownPath.length - 1].type === 'ooz_breakdown'
                  ? 'Детализация ООЗ'
                  : drillDownPath[drillDownPath.length - 1].type === 'cost_growth_breakdown'
                  ? 'Детализация роста стоимости'
                  : drillDownPath[drillDownPath.length - 1].type === 'reserve_breakdown'
                  ? 'Запас на сдачу объекта'
                  : drillDownPath[drillDownPath.length - 1].indicatorName || 'Детализация'}
              </Text>
            </div>

            <Table
              dataSource={getSummaryTableData()}
              columns={summaryTableColumns}
              pagination={false}
              size="small"
              bordered
              scroll={{ x: 650 }}
              summary={(pageData) => {
                const totalAmount = pageData.reduce((sum, item) => sum + item.amount, 0);
                const totalAreaM2 = spTotal;
                const avgPricePerM2 = totalAreaM2 > 0 ? totalAmount / totalAreaM2 : 0;

                return (
                  <Table.Summary.Row style={{ background: currentTheme === 'dark' ? '#262626' : '#fafafa' }}>
                    <Table.Summary.Cell index={0} colSpan={2}>
                      <Text strong>ИТОГО:</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <Text strong style={{ color: '#1890ff' }}>{formatNumber(totalAmount)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Text strong>{formatNumber(Math.round(avgPricePerM2))}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
            />
          </Card>
        </Col>
      </Row>
      )}

      {/* Справочная информация */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card
            bordered
            style={{
              background: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
            }}
          >
            <Title level={5} style={{ marginBottom: 16 }}>
              Справочная информация
            </Title>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text>1. Стоимость монолита за м³</Text>
                <Text strong style={{ fontSize: 16 }}>
                  {formatNumber(Math.round(referenceInfo.monolithPerM3))} руб/м³
                </Text>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text>2. Стоимость ВИСов за м²</Text>
                <Text strong style={{ fontSize: 16 }}>
                  {formatNumber(Math.round(referenceInfo.visPerM2))} руб/м²
                </Text>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text>3. Стоимость Фасадов за м²</Text>
                <Text strong style={{ fontSize: 16 }}>
                  {formatNumber(Math.round(referenceInfo.facadePerM2))} руб/м²
                </Text>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
};
