import type { IndicatorRow } from '../../hooks/useFinancialData';
import type { DrillDownLevel, SummaryTableRow } from './types';

// Проверка, доступна ли детализация для данного показателя
export const hasDetailedBreakdown = (rowNumber: number): boolean => {
  // Детализация доступна только для показателей, привязанных к boq_items
  // 2 = Субподряд, 3 = Работы+Материалы СУ-10, 4 = Запас на сдачу объекта
  return rowNumber === 2 || rowNumber === 3 || rowNumber === 4;
};

// Получаем данные для таблицы детализации в зависимости от текущего уровня drill-down
export const getSummaryTableData = (
  data: IndicatorRow[],
  drillDownPath: DrillDownLevel[],
  spTotal: number,
): SummaryTableRow[] => {
  const currentLevel = drillDownPath[drillDownPath.length - 1];
  const totalAreaM2 = spTotal; // Используем только площадь по СП

  if (currentLevel.type === 'root') {
    // Корневой уровень: показываем Прямые затраты и Наценки
    // НДС уже включён в total_cost каждой строки (если isVatInConstructor)
    const directCosts = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 2 && d.row_number <= 7)
      .reduce((sum, d) => sum + (d.total_cost || 0), 0);

    const markups = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 8 && d.row_number <= 16)
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
