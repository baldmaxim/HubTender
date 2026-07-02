import type { ProjectFull } from '../../../../lib/types/types';

// Общие типы/константы диаграммы Ганта. Не называть модуль ganttChartData.ts —
// имя занято src/utils/excel/gantt/ganttChartData.ts (нативные Excel-графики).

export interface MonthData {
  year: number;
  month: number;
  label: string;
  shortLabel: string;
  isCurrent: boolean;
  isPast: boolean;
}

// Цель клика по мини-графику: проект + его цветовой индекс.
export type ChartModalTarget = { project: ProjectFull; colorIndex: number };

export const COLORS = [
  '#1890ff', '#52c41a', '#faad14', '#722ed1',
  '#eb2f96', '#13c2c2', '#fa541c', '#2f54eb',
];

export const formatMoney = (value: number): string => {
  if (value >= 1_000_000_000) {
    const billions = value / 1_000_000_000;
    if (billions % 1 === 0) {
      return `${billions.toFixed(0)} млрд`;
    }
    return `${billions.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} млрд`;
  }
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    if (millions % 1 === 0) {
      return `${millions.toFixed(0)} млн`;
    }
    return `${millions.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} млн`;
  }
  return value.toLocaleString('ru-RU');
};

export const MONTH_NAMES_SHORT = [
  'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
  'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
];
