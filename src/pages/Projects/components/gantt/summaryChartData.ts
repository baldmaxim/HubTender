import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import type { ChartDataset } from 'chart.js';
import type { ProjectFull, ProjectCompletion } from '../../../../lib/supabase/types';
import { MONTH_NAMES_SHORT } from './ganttUtils';

// Плагины идемпотентны — повторное extend безопасно.
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

// Summary chart data - monthly totals across all visible projects (actual + forecast)
export const buildSummaryChartData = (
  visibleProjects: ProjectFull[],
  completionData: ProjectCompletion[],
) => {
  const now = dayjs();
  const visibleProjectIds = new Set(visibleProjects.map(p => p.id));

  // Find earliest project start date
  let earliestDate = now.subtract(12, 'month').startOf('month');
  visibleProjects.forEach((p) => {
    if (p.contract_date) {
      const projectStart = dayjs(p.contract_date).startOf('month');
      if (projectStart.isBefore(earliestDate)) {
        earliestDate = projectStart;
      }
    }
  });

  // Find the latest month with any completion data (actual or forecast)
  let latestDataDate = now.add(6, 'month').endOf('month');
  completionData.forEach((c) => {
    if (!visibleProjectIds.has(c.project_id)) return; // Skip hidden projects
    const hasData = c.actual_amount > 0 || (c.forecast_amount && c.forecast_amount > 0);
    if (hasData) {
      const dataDate = dayjs(`${c.year}-${c.month}-01`);
      if (dataDate.isAfter(latestDataDate)) {
        latestDataDate = dataDate;
      }
    }
  });

  // End date should be at least 6 months from now, or the latest data month, whichever is later
  const endDate = latestDataDate.endOf('month');

  // Generate all months in range
  const allMonths: { key: string; label: string; year: number; month: number }[] = [];
  let current = earliestDate;
  while (current.isSameOrBefore(endDate, 'month')) {
    const key = `${current.year()}-${String(current.month() + 1).padStart(2, '0')}`;
    allMonths.push({
      key,
      label: `${MONTH_NAMES_SHORT[current.month()]} ${current.year().toString().slice(-2)}`,
      year: current.year(),
      month: current.month() + 1,
    });
    current = current.add(1, 'month');
  }

  // Group actual and forecast completion data by month (independently, only visible projects)
  const monthlyActualTotals: Record<string, number> = {};
  const monthlyForecastTotals: Record<string, number> = {};

  completionData.forEach((c) => {
    if (!visibleProjectIds.has(c.project_id)) return; // Skip hidden projects
    const key = `${c.year}-${String(c.month).padStart(2, '0')}`;

    // Collect actual amounts
    if (c.actual_amount > 0) {
      monthlyActualTotals[key] = (monthlyActualTotals[key] || 0) + c.actual_amount;
    }

    // Collect forecast amounts (independently from actual)
    if (c.forecast_amount && c.forecast_amount > 0) {
      monthlyForecastTotals[key] = (monthlyForecastTotals[key] || 0) + c.forecast_amount;
    }
  });

  // Find first and last month with actual data
  const monthsWithActual = allMonths.filter((m) => monthlyActualTotals[m.key] > 0);
  const lastMonthWithActual = monthsWithActual.length > 0
    ? monthsWithActual[monthsWithActual.length - 1]
    : null;

  // Find last month with ANY data (actual or forecast)
  const monthsWithData = allMonths.filter((m) =>
    monthlyActualTotals[m.key] > 0 || monthlyForecastTotals[m.key] > 0
  );
  const lastMonthWithData = monthsWithData.length > 0
    ? monthsWithData[monthsWithData.length - 1]
    : null;

  // Build actual data array (shows actual + forecast sum where actual exists)
  const actualData = allMonths.map((m) => {
    // Stop at last month with actual data
    if (lastMonthWithActual && m.key > lastMonthWithActual.key) {
      return null;
    }
    // If has actual, show actual + forecast (if forecast also exists in same month)
    if (monthlyActualTotals[m.key]) {
      const actual = monthlyActualTotals[m.key];
      const forecast = monthlyForecastTotals[m.key] || 0;
      return (actual + forecast) / 1_000_000;
    }
    return null;
  });

  // Build forecast data array (continues line after last actual month)
  const forecastData = allMonths.map((m) => {
    // Stop at last month with any data
    if (lastMonthWithData && m.key > lastMonthWithData.key) {
      return null;
    }

    // If this month has actual data, check if we need it for connection
    if (monthlyActualTotals[m.key]) {
      // Include last actual point to connect with forecast line after it
      if (lastMonthWithActual && m.key === lastMonthWithActual.key) {
        const actual = monthlyActualTotals[m.key];
        const forecast = monthlyForecastTotals[m.key] || 0;
        return (actual + forecast) / 1_000_000;
      }
      return null;
    }

    // If no actual data but has forecast, show forecast (only after last actual month)
    if (monthlyForecastTotals[m.key] && monthlyForecastTotals[m.key] > 0) {
      // Only show forecast if we're after the last actual month (or if there's no actual at all)
      if (!lastMonthWithActual || m.key > lastMonthWithActual.key) {
        return monthlyForecastTotals[m.key] / 1_000_000;
      }
    }

    return null;
  });

  const hasActual = actualData.some(v => v !== null);
  const hasForecast = forecastData.some(v => v !== null);

  if (allMonths.length === 0 || (!hasActual && !hasForecast)) return null;

  const datasets: ChartDataset<'line'>[] = [];

  if (hasActual) {
    datasets.push({
      data: actualData,
      borderColor: '#52c41a',
      backgroundColor: 'rgba(82, 196, 26, 0.15)',
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
      borderColor: '#faad14',
      backgroundColor: 'rgba(250, 173, 20, 0.15)',
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

  return {
    labels: allMonths.map((m) => m.label),
    datasets,
  };
};
