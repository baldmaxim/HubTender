import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import type { ChartDataset } from 'chart.js';
import type { ProjectFull, ProjectCompletion } from '../../../../lib/types/types';
import { COLORS, MONTH_NAMES_SHORT } from './ganttUtils';

// Плагины идемпотентны — повторное extend безопасно (модуль может грузиться
// раньше/позже GanttChart.tsx).
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

// Generate mini chart data for a project (actual + forecast as continuation)
export const getProjectChartData = (
  project: ProjectFull,
  colorIndex: number,
  completionData: ProjectCompletion[],
) => {
  const color = COLORS[colorIndex % COLORS.length];
  const forecastColor = '#faad14'; // Orange for forecast

  const projectCompletion = completionData.filter((c) => c.project_id === project.id);

  if (projectCompletion.length === 0) {
    return null;
  }

  // Sort by date
  const sorted = [...projectCompletion].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

  // Actual data counts only for months up to the current month (future months can't have real actuals)
  const nowYear = dayjs().year();
  const nowMonth = dayjs().month() + 1;
  const isActualMonth = (year: number, month: number) =>
    year < nowYear || (year === nowYear && month <= nowMonth);

  // Find index of last actual data
  const lastActualIndex = sorted.reduce((lastIdx, c, idx) => {
    if (isActualMonth(c.year, c.month) && (c.actual_amount > 0 || (c.actual_amount === 0 && isActualMonth(c.year, c.month)))) {
      return idx;
    }
    return lastIdx;
  }, -1);

  // Build actual data array (show zero values for past/current months)
  const actualData = sorted.map((c, idx) => {
    if (idx <= lastActualIndex && isActualMonth(c.year, c.month)) {
      return (c.actual_amount || 0) / 1_000_000;
    }
    return null;
  });

  // Build forecast data array (starts from last actual point, or from beginning if no actual data)
  const forecastData = sorted.map((c, idx) => {
    // If there's no actual data at all (lastActualIndex === -1), show all forecast
    if (lastActualIndex === -1) {
      return c.forecast_amount && c.forecast_amount > 0 ? c.forecast_amount / 1_000_000 : null;
    }

    // Include last actual point to connect the lines
    if (idx === lastActualIndex) {
      return (sorted[idx].actual_amount || 0) / 1_000_000;
    }
    // Show forecast only after last actual
    if (idx > lastActualIndex && c.forecast_amount && c.forecast_amount > 0) {
      return c.forecast_amount / 1_000_000;
    }
    return null;
  });

  const hasActual = actualData.some(v => v !== null);
  const hasForecast = forecastData.some(v => v !== null);

  if (!hasActual && !hasForecast) {
    return null;
  }

  const datasets: ChartDataset<'line'>[] = [];

  if (hasActual) {
    datasets.push({
      data: actualData,
      borderColor: color,
      backgroundColor: `${color}15`,
      tension: 0.4,
      fill: true,
      borderWidth: 1.5,
      pointRadius: 0,
      spanGaps: false,
      datalabels: { display: false },
    });
  }

  if (hasForecast) {
    datasets.push({
      data: forecastData,
      borderColor: forecastColor,
      backgroundColor: `${forecastColor}15`,
      tension: 0.4,
      fill: true,
      borderWidth: 1.5,
      pointRadius: 0,
      borderDash: [5, 5], // Dashed line for forecast
      spanGaps: false,
      datalabels: { display: false },
    });
  }

  return {
    labels: sorted.map(() => ''), // Empty labels
    datasets,
  };
};

// Generate full chart data for modal (full construction period on X axis)
export const getFullProjectChartData = (
  project: ProjectFull,
  colorIndex: number,
  completionData: ProjectCompletion[],
) => {
  const color = COLORS[colorIndex % COLORS.length];
  const forecastColor = '#faad14'; // Orange for forecast

  const startDate = project.contract_date ? dayjs(project.contract_date) : null;
  const endDate = project.construction_end_date ? dayjs(project.construction_end_date) : null;

  if (!startDate || !endDate) {
    // Fallback to just actual data if no dates set
    return getProjectChartData(project, colorIndex, completionData);
  }

  // Get project's completion data (all data, not just actual)
  const projectCompletion = completionData.filter(
    (c) => c.project_id === project.id
  );

  // Find the last month with actual data
  const now = dayjs();
  const currentMonthEnd = now.endOf('month');

  let lastActualMonth: dayjs.Dayjs | null = null;
  const completionWithActual = projectCompletion.filter(c => {
    const monthDate = dayjs(`${c.year}-${c.month}-01`);
    return monthDate.isSameOrBefore(currentMonthEnd, 'month') && c.actual_amount > 0;
  });
  if (completionWithActual.length > 0) {
    const sortedCompletion = [...completionWithActual].sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
    lastActualMonth = dayjs(`${sortedCompletion[0].year}-${sortedCompletion[0].month}-01`);
  }

  // Generate ALL months from start to end (full construction period)
  const allMonths: { year: number; month: number; label: string }[] = [];
  let current = startDate.startOf('month');

  while (current.isSameOrBefore(endDate, 'month')) {
    allMonths.push({
      year: current.year(),
      month: current.month() + 1,
      label: `${MONTH_NAMES_SHORT[current.month()]} ${current.year().toString().slice(-2)}`,
    });
    current = current.add(1, 'month');
  }

  // Build actual data array
  const actualData = allMonths.map((m) => {
    const monthDate = dayjs(`${m.year}-${m.month}-01`);

    // If this month is after the last month with actual data, return null (line ends)
    if (lastActualMonth && monthDate.isAfter(lastActualMonth, 'month')) {
      return null;
    }

    const completion = projectCompletion.find(
      (c) => c.year === m.year && c.month === m.month
    );
    if (!completion) return null;
    // Show actual for months up to current month (including zero)
    if (monthDate.isSameOrBefore(currentMonthEnd, 'month') && completion.actual_amount != null) {
      return completion.actual_amount / 1_000_000;
    }
    return null;
  });

  // Build forecast data array (starts from last actual point, or from beginning if no actual data)
  const forecastData = allMonths.map((m) => {
    const monthDate = dayjs(`${m.year}-${m.month}-01`);

    // If there's no actual data at all, show all forecast data
    if (!lastActualMonth) {
      const completion = projectCompletion.find(
        (c) => c.year === m.year && c.month === m.month
      );
      return completion && completion.forecast_amount && completion.forecast_amount > 0
        ? completion.forecast_amount / 1_000_000
        : null;
    }

    // Include last actual point to connect the lines
    if (monthDate.isSame(lastActualMonth, 'month')) {
      const completion = projectCompletion.find(
        (c) => c.year === m.year && c.month === m.month
      );
      return completion ? (completion.actual_amount || 0) / 1_000_000 : null;
    }

    // Show forecast only after last actual
    if (monthDate.isAfter(lastActualMonth, 'month')) {
      const completion = projectCompletion.find(
        (c) => c.year === m.year && c.month === m.month
      );
      return completion && completion.forecast_amount && completion.forecast_amount > 0
        ? completion.forecast_amount / 1_000_000
        : null;
    }

    return null;
  });

  const hasActual = actualData.some(v => v !== null);
  const hasForecast = forecastData.some(v => v !== null);

  const datasets: ChartDataset<'line'>[] = [];

  if (hasActual) {
    datasets.push({
      data: actualData,
      borderColor: color,
      backgroundColor: `${color}20`,
      tension: 0.3,
      fill: true,
      pointRadius: 3,
      pointHoverRadius: 6,
      spanGaps: true,
      datalabels: { display: false },
      label: 'Факт',
    });
  }

  if (hasForecast) {
    datasets.push({
      data: forecastData,
      borderColor: forecastColor,
      backgroundColor: `${forecastColor}20`,
      tension: 0.3,
      fill: true,
      pointRadius: 3,
      pointHoverRadius: 6,
      borderDash: [5, 5], // Dashed line for forecast
      spanGaps: true,
      datalabels: { display: false },
      label: 'Прогноз',
    });
  }

  if (!hasActual && !hasForecast) {
    return null;
  }

  return {
    labels: allMonths.map((m) => m.label),
    datasets,
  };
};
