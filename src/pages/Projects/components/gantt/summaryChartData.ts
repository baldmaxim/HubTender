import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import type { ChartDataset } from 'chart.js';
import type { ProjectFull, ProjectCompletion } from '../../../../lib/types/types';
import { MONTH_NAMES_SHORT, isForecastMonth } from './ganttUtils';

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
  const monthlyPlanTotals: Record<string, number> = {};

  completionData.forEach((c) => {
    if (!visibleProjectIds.has(c.project_id)) return; // Skip hidden projects
    const key = `${c.year}-${String(c.month).padStart(2, '0')}`;

    // Collect actual amounts
    if (c.actual_amount > 0) {
      monthlyActualTotals[key] = (monthlyActualTotals[key] || 0) + c.actual_amount;
    }

    if (c.forecast_amount && c.forecast_amount > 0) {
      // План — forecast_amount по всем месяцам
      monthlyPlanTotals[key] = (monthlyPlanTotals[key] || 0) + c.forecast_amount;
      // Прогноз — только месяцы не раньше текущего и без факта
      if (isForecastMonth(c.year, c.month) && c.actual_amount <= 0) {
        monthlyForecastTotals[key] = (monthlyForecastTotals[key] || 0) + c.forecast_amount;
      }
    }
  });

  // Текущий и будущие месяцы не закрыты: их факт идёт в прогнозную линию, а не в «Факт»
  const isOpenMonth = (key: string) => {
    const [y, mo] = key.split('-').map(Number);
    return isForecastMonth(y, mo);
  };

  // Find first and last month with actual data (only closed months)
  const monthsWithActual = allMonths.filter((m) => monthlyActualTotals[m.key] > 0 && !isOpenMonth(m.key));
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

  // Build actual data array (only actual — forecast of the same month is not mixed in)
  const actualData = allMonths.map((m) => {
    // Stop at last month with actual data
    if (lastMonthWithActual && m.key > lastMonthWithActual.key) {
      return null;
    }
    if (monthlyActualTotals[m.key]) {
      return monthlyActualTotals[m.key] / 1_000_000;
    }
    return null;
  });

  // Build forecast data array (continues line after last actual month)
  const forecastData = allMonths.map((m) => {
    // Stop at last month with any data
    if (lastMonthWithData && m.key > lastMonthWithData.key) {
      return null;
    }

    // Стык: последний закрытый месяц с фактом — та же точка, что у линии «Факт»
    if (lastMonthWithActual && m.key === lastMonthWithActual.key) {
      return monthlyActualTotals[m.key] / 1_000_000;
    }

    // Открытые месяцы: уже полученный факт + прогноз остальных объектов
    if (isOpenMonth(m.key)) {
      const total = (monthlyActualTotals[m.key] || 0) + (monthlyForecastTotals[m.key] || 0);
      return total > 0 ? total / 1_000_000 : null;
    }

    return null;
  });

  // План: сумма forecast_amount по всем месяцам
  const planData = allMonths.map((m) =>
    monthlyPlanTotals[m.key] > 0 ? monthlyPlanTotals[m.key] / 1_000_000 : null,
  );

  const hasActual = actualData.some(v => v !== null);
  const hasForecast = forecastData.some(v => v !== null);
  const hasPlan = planData.some(v => v !== null);

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

  if (hasPlan) {
    datasets.push({
      data: planData,
      borderColor: 'rgba(140, 140, 140, 0.55)',
      tension: 0.3,
      fill: false,
      borderWidth: 1.5,
      borderDash: [4, 4],
      pointRadius: 0,
      pointHoverRadius: 3,
      spanGaps: true,
      order: 10, // под фактом и прогнозом
      datalabels: { display: false },
      label: 'План',
    });
  }

  return {
    labels: allMonths.map((m) => m.label),
    datasets,
  };
};
