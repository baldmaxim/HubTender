import type { IndicatorRow } from '../../hooks/useFinancialData';
import type { CategoryBreakdown, DrillDownLevel } from './types';
import { hasDetailedBreakdown } from './drillDownRows';

// Данные для круговой диаграммы - адаптивные в зависимости от уровня drill-down
export const getCategoriesData = (params: {
  data: IndicatorRow[];
  drillDownPath: DrillDownLevel[];
  breakdownData: CategoryBreakdown[];
  currentTheme: string;
}) => {
  const { data, drillDownPath, breakdownData, currentTheme } = params;
  const currentLevel = drillDownPath[drillDownPath.length - 1];

  // Уровень 1 (корень): Показываем только "Прямые затраты" и "Наценки"
  if (currentLevel.type === 'root') {
    if (data.length === 0) return null;

    // Фильтруем данные
    const baseData = data.filter(d =>
      !d.is_header &&
      !d.is_total &&
      d.row_number >= 2 &&
      d.row_number <= 16
    );

    // Прямые затраты: строки 2-7 (Субподряд, СУ-10, Запас на сдачу, СМ, МБП+ГСМ, Гарантия)
    // НДС уже включён в total_cost каждой строки (если isVatInConstructor)
    const directCosts = baseData
      .filter(d => d.row_number >= 2 && d.row_number <= 7)
      .reduce((sum, d) => sum + (d.total_cost || 0), 0);

    // Наценки: строки 8-16 (включая страхование от судимостей, строка 16)
    const markups = baseData
      .filter(d => d.row_number >= 8 && d.row_number <= 16)
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
