import type { ChartEvent, ActiveElement } from 'chart.js';
import type { IndicatorRow } from '../../hooks/useFinancialData';
import type { DrillDownLevel } from './types';

/**
 * Обработчики кликов по сегментам круговой и столбцам барной диаграмм
 * (drill-down навигация). Перенесено из IndicatorsCharts без изменений
 * логики — включая известное расхождение сортировки direct_costs между
 * билдерами и клик-маппингом (существующее поведение, не «чинить» здесь).
 */
export const useChartDrillDown = ({
  data,
  drillDownPath,
  setDrillDownPath,
  isPhoneDevice,
  isVatInConstructor,
  setSelectedIndicator,
  setLoadingBreakdown,
  fetchCategoryBreakdown,
}: {
  data: IndicatorRow[];
  drillDownPath: DrillDownLevel[];
  setDrillDownPath: React.Dispatch<React.SetStateAction<DrillDownLevel[]>>;
  isPhoneDevice: boolean;
  isVatInConstructor: boolean;
  setSelectedIndicator: (v: number | null) => void;
  setLoadingBreakdown: (v: boolean) => void;
  fetchCategoryBreakdown: (rowNumber: number) => Promise<void>;
}) => {
  // Обработчик клика на сегмент круговой диаграммы
  const handlePieClick = async (_event: ChartEvent, elements: ActiveElement[]) => {
    if (elements.length === 0) return;

    const index = elements[0].index;
    const currentLevel = drillDownPath[drillDownPath.length - 1];

    // На телефоне 3-й уровень отключён: с 2-го уровня вглубь не уходим.
    if (isPhoneDevice && (currentLevel.type === 'direct_costs' || currentLevel.type === 'markups')) {
      return;
    }

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
        d.row_number <= 16
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
        .filter(d => d && (d.total_cost || 0) !== 0); // как в рендере: скрываем нулевые строки, чтобы индексы совпадали

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
        } else if (clickedRow.row_number === 16) {
          // Страхование от судимостей — нет дальнейшей детализации, клик игнорируем
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

  // Обработчик клика по столбцу в барной диаграмме
  const handleBarClick = async (_event: ChartEvent, elements: ActiveElement[]) => {
    if (elements.length === 0) return;

    const clickedIndex = elements[0].index;
    const currentLevel = drillDownPath[drillDownPath.length - 1];

    // На телефоне 3-й уровень отключён: с 2-го уровня вглубь не уходим.
    if (isPhoneDevice && (currentLevel.type === 'direct_costs' || currentLevel.type === 'markups')) {
      return;
    }

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
        d.row_number <= 16
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
        .filter(d => d && (d.total_cost || 0) !== 0); // как в рендере: скрываем нулевые строки, чтобы индексы совпадали

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
        } else if (clickedRow.row_number === 16) {
          // Страхование от судимостей — нет дальнейшей детализации, клик игнорируем
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

  return { handlePieClick, handleBarClick };
};
