import type { IndicatorRow } from '../../hooks/useFinancialData';
import type { CategoryBreakdown, DrillDownLevel } from './types';

// Данные для столбчатой диаграммы "Стоимость за м²"
export const getAreaBarData = (params: {
  data: IndicatorRow[];
  drillDownPath: DrillDownLevel[];
  breakdownData: CategoryBreakdown[];
  selectedIndicator: number | null;
  selectedTenderId: string | null;
  spTotal: number;
}) => {
  const { data, drillDownPath, breakdownData, selectedIndicator, selectedTenderId, spTotal } = params;
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

    const markups = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 8 && d.row_number <= 16)
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
