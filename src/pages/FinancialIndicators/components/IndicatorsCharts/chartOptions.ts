import type { Chart, TooltipItem, LegendItem as ChartLegendItem, ChartEvent, ActiveElement, LegendElement } from 'chart.js';
import type { CategoryBreakdown, DrillDownLevel } from './types';

/**
 * Фабрики опций chart.js для круговой и барной диаграмм. Перенесено из
 * IndicatorsCharts без изменений логики; обработчики кликов и текущий
 * drill-down уровень приходят параметрами.
 */
export const buildPieOptions = ({
  currentTheme,
  isPhone,
  isPhoneDevice,
  drillDownPath,
  handlePieClick,
}: {
  currentTheme: string;
  isPhone: boolean;
  isPhoneDevice: boolean;
  drillDownPath: DrillDownLevel[];
  handlePieClick: (event: ChartEvent, elements: ActiveElement[]) => Promise<void> | void;
}) => ({
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
      position: isPhone ? ('bottom' as const) : ('right' as const),
      labels: {
        color: currentTheme === 'dark' ? '#ffffff' : '#000000',
        padding: isPhone ? 4 : 6,
        font: { size: isPhoneDevice ? 9 : 10 },
        boxWidth: isPhone ? 10 : 12,
        boxHeight: isPhone ? 10 : 12,
        generateLabels: function(chart: Chart) {
          const currentLevel = drillDownPath[drillDownPath.length - 1];
          const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

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
            const dataArr1 = chart.data.datasets[0].data as number[];
            const total = dataArr1.reduce((a: number, b: number) => a + b, 0);
            (chart.data.labels as string[]).forEach((label: string, i: number) => {
              const value = dataArr1[i] ?? 0;
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
              labels.push({
                text: `${truncate(label, isPhoneDevice ? 20 : 40)} (${percentage}%)`,
                fillStyle: (chart.data.datasets[0]!.backgroundColor as string[])[i],
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
            const dataArr2 = chart.data.datasets[0].data as number[];
            const totalMarkups = dataArr2.reduce((a: number, b: number) => a + b, 0);
            (chart.data.labels as string[]).forEach((label: string, i: number) => {
              const value = dataArr2[i] ?? 0;
              const percentage = totalMarkups > 0 ? ((value / totalMarkups) * 100).toFixed(1) : '0.0';
              labels.push({
                text: `${truncate(label, isPhoneDevice ? 20 : 40)} (${percentage}%)`,
                fillStyle: (chart.data.datasets[0]!.backgroundColor as string[])[i],
                hidden: false,
                index: i,
                fontColor: currentTheme === 'dark' ? '#ffffff' : '#000000',
              });
            });

            return labels;
          }

          // Для всех остальных уровней (root, indicator, profit_breakdown) - стандартные метки с процентами
          const dataArr3 = chart.data.datasets[0].data as number[];
          const total = dataArr3.reduce((a: number, b: number) => a + b, 0);
          return (chart.data.labels as string[]).map((label: string, i: number) => {
            const value = dataArr3[i] ?? 0;
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
            return {
              text: `${truncate(label, isPhoneDevice ? 20 : 40)} (${percentage}%)`,
              fillStyle: (chart.data.datasets[0]!.backgroundColor as string[])[i],
              hidden: false,
              index: i,
              fontColor: currentTheme === 'dark' ? '#ffffff' : '#000000',
            };
          });
        },
      },
      maxWidth: isPhone ? 360 : 200,
      onClick: function(e: ChartEvent, legendItem: ChartLegendItem, legend: LegendElement<'doughnut'>) {
        // Игнорируем клики на заголовки и разделители
        if (legendItem.index == null || legendItem.index < 0) return;

        // Стандартное поведение для остальных элементов
        const index = legendItem.index;
        const chart = legend.chart;

        // Вызываем handlePieClick программно
        const elements = chart.getElementsAtEventForMode(e as unknown as Event, 'nearest', { intersect: true }, false);
        if (elements.length === 0) {
          // Создаем псевдо-элемент для handlePieClick
          handlePieClick(e, [{ index, datasetIndex: 0, element: chart.getDatasetMeta(0).data[index] }]);
        }
      },
    },
    tooltip: {
      callbacks: {
        label: function(context: TooltipItem<'doughnut'>) {
          const label = context.label || '';
          const value = (context.parsed as number) || 0;
          const total = (context.dataset.data as number[]).reduce((a: number, b: number) => a + b, 0);
          const percentage = ((value / total) * 100).toFixed(1);
          return `${label}: ${value.toLocaleString('ru-RU')} руб. (${percentage}%)`;
        }
      }
    },
    datalabels: { display: false },
  },
});

export const buildBarOptions = ({
  currentTheme,
  isPhoneDevice,
  currentLevel,
  breakdownData,
  handleBarClick,
}: {
  currentTheme: string;
  isPhoneDevice: boolean;
  currentLevel: DrillDownLevel;
  breakdownData: CategoryBreakdown[];
  handleBarClick: (event: ChartEvent, elements: ActiveElement[]) => Promise<void> | void;
}) => ({
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
        label: function(context: TooltipItem<'bar'>) {
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
          size: isPhoneDevice ? 9 : (currentLevel.type === 'indicator' && breakdownData.length > 0 ? 10 : 12)
        },
        maxRotation: isPhoneDevice ? 90 : 0,
        minRotation: isPhoneDevice ? 90 : 0,
        autoSkip: isPhoneDevice ? true : false,
        autoSkipPadding: 4,
        callback: function(this: { getLabelForValue: (v: number) => string }, value: number): string | string[] {
          const label = this.getLabelForValue(value);
          const maxLen = isPhoneDevice ? 16 : (currentLevel.type === 'markups' ? 14 : 20);
          // Разбиваем длинные метки на несколько строк
          const shouldWrap =
            isPhoneDevice ||
            (currentLevel.type === 'indicator' && breakdownData.length > 0) ||
            currentLevel.type === 'markups';
          if (shouldWrap) {
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
});
