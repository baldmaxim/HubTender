import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Typography, Empty, Tooltip, Progress, Button, Modal, message } from 'antd';
import { DownloadOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import { Line } from 'react-chartjs-2';
import * as XLSX from 'xlsx-js-style';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title as ChartTitle,
  Tooltip as ChartTooltip,
  Legend,
  Filler,
} from 'chart.js';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ProjectFull, ProjectCompletion } from '../../../lib/supabase/types';
import { getErrorMessage } from '../../../utils/errors';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ChartTitle,
  ChartTooltip,
  Legend,
  Filler
);

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);
dayjs.locale('ru');

const { Text } = Typography;

interface GanttChartProps {
  projects: ProjectFull[];
  completionData: ProjectCompletion[];
}

interface MonthData {
  year: number;
  month: number;
  label: string;
  shortLabel: string;
  isCurrent: boolean;
  isPast: boolean;
}

const COLORS = [
  '#1890ff', '#52c41a', '#faad14', '#722ed1',
  '#eb2f96', '#13c2c2', '#fa541c', '#2f54eb',
];

const formatMoney = (value: number): string => {
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

const MONTH_NAMES_SHORT = [
  'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
  'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
];

export const GanttChart: React.FC<GanttChartProps> = ({ projects, completionData }) => {
  const { theme } = useTheme();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [chartModalProject, setChartModalProject] = useState<{ project: ProjectFull; colorIndex: number } | null>(null);
  const [summaryChartOpen, setSummaryChartOpen] = useState(false);
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(new Set());

  // Filter visible projects based on hidden state
  const visibleProjects = useMemo(() => {
    return projects.filter(p => !hiddenProjects.has(p.id));
  }, [projects, hiddenProjects]);

  // Hide a project
  const hideProject = useCallback((projectId: string) => {
    setHiddenProjects(prev => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
  }, []);

  // Show all hidden projects by clearing the hidden projects set
  const showAllHiddenProjects = useCallback(() => {
    setHiddenProjects(new Set());
  }, []);

  // Generate months timeline - from earliest project date to current + 4 years
  const { months, monthWidth } = useMemo(() => {
    if (visibleProjects.length === 0) return { months: [], monthWidth: 80 };

    const now = dayjs();

    // Find earliest project start date
    let minDate = now.startOf('month');
    visibleProjects.forEach((p) => {
      if (p.contract_date) {
        const start = dayjs(p.contract_date).startOf('month');
        if (start.isBefore(minDate)) {
          minDate = start;
        }
      }
    });

    // Also check completion data for earlier dates
    completionData.forEach((c) => {
      const completionDate = dayjs(`${c.year}-${c.month}-01`);
      if (completionDate.isBefore(minDate)) {
        minDate = completionDate.startOf('month');
      }
    });

    // End date is current + 4 years
    const maxDate = now.add(4, 'year').endOf('month');

    const monthsList: MonthData[] = [];
    let current = minDate;

    while (current.isBefore(maxDate) || current.isSame(maxDate, 'month')) {
      const year = current.year();
      const month = current.month();

      monthsList.push({
        year,
        month: month + 1,
        label: `${MONTH_NAMES_SHORT[month]} ${year}`,
        shortLabel: MONTH_NAMES_SHORT[month],
        isCurrent: current.isSame(now, 'month'),
        isPast: current.isBefore(now, 'month'),
      });

      current = current.add(1, 'month');
    }

    return { months: monthsList, monthWidth: 80 };
  }, [visibleProjects, completionData]);

  // Calculate totals across all visible projects
  const totals = useMemo(() => {
    const totalContract = visibleProjects.reduce((sum, p) => sum + p.final_contract_cost, 0);
    const totalCompletion = visibleProjects.reduce((sum, p) => sum + p.total_completion, 0);
    const totalRemaining = totalContract - totalCompletion;
    const completionPercent = totalContract > 0 ? (totalCompletion / totalContract) * 100 : 0;
    return { totalContract, totalCompletion, totalRemaining, completionPercent };
  }, [visibleProjects]);

  // Calculate monthly totals (sum across all visible projects per month)
  // Sum both actual and forecast amounts
  const monthlyTotals = useMemo(() => {
    const totalsMap: Record<string, number> = {};
    const visibleProjectIds = new Set(visibleProjects.map(p => p.id));

    months.forEach((month) => {
      const key = `${month.year}-${month.month}`;
      const monthTotal = completionData
        .filter((c) => c.year === month.year && c.month === month.month && visibleProjectIds.has(c.project_id))
        .reduce((sum, c) => {
          // Sum both actual and forecast
          const actual = c.actual_amount > 0 ? c.actual_amount : 0;
          const forecast = c.forecast_amount && c.forecast_amount > 0 ? c.forecast_amount : 0;
          return sum + actual + forecast;
        }, 0);
      totalsMap[key] = monthTotal;
    });

    return totalsMap;
  }, [months, completionData, visibleProjects]);

  // Scroll to current month on mount
  useEffect(() => {
    if (scrollRef.current && months.length > 0) {
      const currentIndex = months.findIndex((m) => m.isCurrent);
      if (currentIndex > 2) {
        scrollRef.current.scrollLeft = (currentIndex - 2) * monthWidth;
      }
    }
  }, [months, monthWidth]);

  // Get completion data for a project/month
  const getCompletionForMonth = (projectId: string, year: number, month: number) => {
    return completionData.find(
      (c) => c.project_id === projectId && c.year === year && c.month === month
    );
  };

  // Generate mini chart data for a project (actual + forecast as continuation)
  const getProjectChartData = (project: ProjectFull, colorIndex: number) => {
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

    const datasets: any[] = [];

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
  const getFullProjectChartData = (project: ProjectFull, colorIndex: number) => {
    const color = COLORS[colorIndex % COLORS.length];
    const forecastColor = '#faad14'; // Orange for forecast

    const startDate = project.contract_date ? dayjs(project.contract_date) : null;
    const endDate = project.construction_end_date ? dayjs(project.construction_end_date) : null;

    if (!startDate || !endDate) {
      // Fallback to just actual data if no dates set
      return getProjectChartData(project, colorIndex);
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

    const datasets: any[] = [];

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

  // Mini chart options - completely minimal, no text at all
  const miniChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
      title: { display: false },
    },
    scales: {
      x: { display: false },
      y: { display: false },
    },
    elements: {
      point: { radius: 0 },
      line: { borderWidth: 1.5 },
    },
  }), []);

  // Full chart options for modal - with legend and tooltips
  const fullChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: theme === 'dark' ? '#ffffff85' : '#00000073',
        },
      },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (context: { parsed: { y: number } }) => {
            const value = context.parsed.y;
            if (value >= 1000) {
              return `${(value / 1000).toFixed(2)} млрд ₽`;
            }
            return `${value.toFixed(2)} млн ₽`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: theme === 'dark' ? '#303030' : '#f0f0f0' },
        ticks: { color: theme === 'dark' ? '#ffffff85' : '#00000073' },
      },
      y: {
        grid: { color: theme === 'dark' ? '#303030' : '#f0f0f0' },
        ticks: {
          color: theme === 'dark' ? '#ffffff85' : '#00000073',
          callback: (value: number | string) => {
            const num = typeof value === 'number' ? value : parseFloat(value);
            if (num >= 1000) {
              return `${(num / 1000).toFixed(1)} млрд`;
            }
            return `${num} млн`;
          },
        },
      },
    },
    interaction: {
      intersect: false,
      mode: 'index' as const,
    },
  }), [theme]);

  // Summary chart data - monthly totals across all visible projects (actual + forecast)
  const summaryChartData = useMemo(() => {
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

    const datasets: any[] = [];

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
  }, [completionData, visibleProjects]);

  // Summary chart options
  const summaryChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: theme === 'dark' ? '#ffffff85' : '#00000073',
        },
      },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (context: { parsed: { y: number } }) => {
            const value = context.parsed.y;
            if (value >= 1000) {
              return `${(value / 1000).toFixed(2)} млрд ₽`;
            }
            return `${value.toFixed(2)} млн ₽`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: theme === 'dark' ? '#303030' : '#f0f0f0' },
        ticks: { color: theme === 'dark' ? '#ffffff85' : '#00000073' },
      },
      y: {
        grid: { color: theme === 'dark' ? '#303030' : '#f0f0f0' },
        ticks: {
          color: theme === 'dark' ? '#ffffff85' : '#00000073',
          callback: (value: number | string) => {
            const num = typeof value === 'number' ? value : parseFloat(value);
            if (num >= 1000) {
              return `${(num / 1000).toFixed(1)} млрд`;
            }
            return `${num} млн`;
          },
        },
      },
    },
    interaction: {
      intersect: false,
      mode: 'index' as const,
    },
  }), [theme]);

  // Export completion data to Excel (only visible projects)
  const handleExport = () => {
    try {
      // Create header row with months
      const headers = ['Объект', ...months.map(m => m.label), 'ИТОГО'];

      // Create data rows (one row per visible project)
      const rows: any[][] = [];

      // Determine which months are after current date (for styling)
      const now = dayjs();
      const futureMonthIndices = new Set<number>();
      months.forEach((month, idx) => {
        const monthDate = dayjs(`${month.year}-${month.month}-01`);
        if (monthDate.isAfter(now, 'month')) {
          futureMonthIndices.add(idx);
        }
      });

      visibleProjects.forEach((project) => {
        const row: any[] = [project.name];
        let projectTotal = 0;

        // Add data for each month
        months.forEach((month) => {
          const completion = getCompletionForMonth(project.id, month.year, month.month);
          let value: number | string = '';

          if (completion && completion.actual_amount > 0) {
            value = completion.actual_amount;
            projectTotal += completion.actual_amount;
          } else if (completion && completion.forecast_amount && completion.forecast_amount > 0) {
            value = completion.forecast_amount;
            projectTotal += completion.forecast_amount;
          }
          // Если нет данных, оставляем пустую строку ''

          row.push(value);
        });

        // Add total for this project
        row.push(projectTotal);
        rows.push(row);
      });

      // Add ИТОГО row (sum across all projects)
      const totalsRow: any[] = ['ИТОГО'];
      let grandTotal = 0;

      months.forEach(month => {
        const key = `${month.year}-${month.month}`;
        const monthTotal = monthlyTotals[key] || 0;
        // Не выводим нули в строке ИТОГО
        totalsRow.push(monthTotal > 0 ? monthTotal : '');
        grandTotal += monthTotal;
      });
      totalsRow.push(grandTotal);
      rows.push(totalsRow);

      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

      // Set column widths
      const colWidths = [{ wch: 30 }, ...months.map(() => ({ wch: 12 })), { wch: 15 }];
      ws['!cols'] = colWidths;

      // Style header row
      const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1890FF' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: {
          top: { style: 'thin', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: '000000' } },
          left: { style: 'thin', color: { rgb: '000000' } },
          right: { style: 'thin', color: { rgb: '000000' } },
        },
      };

      // Apply header style
      for (let i = 0; i < headers.length; i++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
        if (!ws[cellRef]) continue;
        ws[cellRef].s = headerStyle;
      }

      // Style for project names (first column)
      const nameStyle = {
        alignment: { horizontal: 'left', vertical: 'center' },
        border: {
          top: { style: 'thin', color: { rgb: 'D9D9D9' } },
          bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
          left: { style: 'thin', color: { rgb: 'D9D9D9' } },
          right: { style: 'thin', color: { rgb: 'D9D9D9' } },
        },
      };

      // Style for numbers
      const numberStyle = {
        numFmt: '#,##0',
        alignment: { horizontal: 'right', vertical: 'center' },
        border: {
          top: { style: 'thin', color: { rgb: 'D9D9D9' } },
          bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
          left: { style: 'thin', color: { rgb: 'D9D9D9' } },
          right: { style: 'thin', color: { rgb: 'D9D9D9' } },
        },
      };

      // Style for empty cells
      const emptyStyle = {
        alignment: { horizontal: 'right', vertical: 'center' },
        border: {
          top: { style: 'thin', color: { rgb: 'D9D9D9' } },
          bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
          left: { style: 'thin', color: { rgb: 'D9D9D9' } },
          right: { style: 'thin', color: { rgb: 'D9D9D9' } },
        },
      };

      // Style for forecast numbers (orange background)
      const forecastStyle = {
        numFmt: '#,##0',
        alignment: { horizontal: 'right', vertical: 'center' },
        fill: { fgColor: { rgb: 'FFE7BA' } }, // Light orange background
        border: {
          top: { style: 'thin', color: { rgb: 'D9D9D9' } },
          bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
          left: { style: 'thin', color: { rgb: 'D9D9D9' } },
          right: { style: 'thin', color: { rgb: 'D9D9D9' } },
        },
      };

      // Style for ИТОГО row
      const totalRowStyle = {
        numFmt: '#,##0',
        font: { bold: true },
        fill: { fgColor: { rgb: 'F0F0F0' } },
        alignment: { horizontal: 'right', vertical: 'center' },
        border: {
          top: { style: 'medium', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
          left: { style: 'thin', color: { rgb: 'D9D9D9' } },
          right: { style: 'thin', color: { rgb: 'D9D9D9' } },
        },
      };

      const totalNameStyle = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'F0F0F0' } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: {
          top: { style: 'medium', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
          left: { style: 'thin', color: { rgb: 'D9D9D9' } },
          right: { style: 'thin', color: { rgb: 'D9D9D9' } },
        },
      };

      // Apply styles to all cells
      for (let r = 1; r <= rows.length; r++) {
        const isLastRow = r === rows.length;

        for (let c = 0; c < headers.length; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (!ws[cellRef]) continue;

          if (c === 0) {
            // First column (project names)
            ws[cellRef].s = isLastRow ? totalNameStyle : nameStyle;
          } else {
            // Number columns
            if (isLastRow) {
              ws[cellRef].s = totalRowStyle;
            } else {
              // Check if cell has value
              const cellValue = ws[cellRef].v;
              const isEmpty = cellValue === '' || cellValue === null || cellValue === undefined;

              if (isEmpty) {
                // Empty cell - no fill, just borders
                ws[cellRef].s = emptyStyle;
              } else {
                // Check if this month is in the future (after current date)
                // Column index: c-1 because first column (c=0) is project name
                const monthIdx = c - 1;
                const isFutureMonth = futureMonthIndices.has(monthIdx);
                ws[cellRef].s = isFutureMonth ? forecastStyle : numberStyle;
              }
            }
          }
        }
      }

      // Create workbook and save
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Выполнение объектов');
      XLSX.writeFile(wb, `Выполнение_объектов_${dayjs().format('YYYY-MM-DD')}.xlsx`);

      message.success('Экспорт завершен успешно');
    } catch (error) {
      message.error('Ошибка экспорта: ' + getErrorMessage(error));
    }
  };

  if (projects.length === 0) {
    return <Empty description="Нет объектов для отображения" />;
  }

  if (visibleProjects.length === 0 && hiddenProjects.size > 0) {
    return (
      <div>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            icon={<EyeOutlined />}
            onClick={showAllHiddenProjects}
          >
            Показать скрытые объекты ({hiddenProjects.size})
          </Button>
        </div>
        <Empty description="Все объекты скрыты. Нажмите кнопку выше для их отображения." />
      </div>
    );
  }

  const rowHeight = 70;
  const headerHeight = 60;
  const projectNameWidth = 200;
  const chartWidth = 150;
  const gridWidth = months.length * monthWidth;

  return (
    <div>
      {/* Export and show hidden buttons */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {hiddenProjects.size > 0 && (
          <Button
            icon={<EyeOutlined />}
            onClick={showAllHiddenProjects}
          >
            Показать скрытые объекты ({hiddenProjects.size})
          </Button>
        )}
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={handleExport}
        >
          Экспорт в Excel
        </Button>
      </div>

      <div
        style={{
          display: 'flex',
          border: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
          borderRadius: '8px 8px 0 0',
          overflow: 'hidden',
          background: theme === 'dark' ? '#141414' : '#fff',
        }}
      >
        {/* Left panel - Project names */}
        <div
        style={{
          width: projectNameWidth,
          flexShrink: 0,
          borderRight: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            height: headerHeight,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            borderBottom: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
            background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
          }}
        >
          <Text strong>Объект</Text>
        </div>

        {/* Project rows */}
        {visibleProjects.map((project, index) => {
          return (
            <div
              key={project.id}
              style={{
                height: rowHeight,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: '0 16px',
                borderBottom: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
                background:
                  hoveredProject === project.id
                    ? theme === 'dark'
                      ? '#262626'
                      : '#f5f5f5'
                    : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={() => setHoveredProject(project.id)}
              onMouseLeave={() => setHoveredProject(null)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button
                  type="text"
                  size="small"
                  icon={<EyeInvisibleOutlined />}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    hideProject(project.id);
                  }}
                  style={{ padding: '0 4px', minWidth: 'auto' }}
                  title="Скрыть объект"
                />
                <Text
                  strong
                  ellipsis
                  style={{
                    color: COLORS[index % COLORS.length],
                    maxWidth: projectNameWidth - 64,
                  }}
                >
                  {project.name}
                </Text>
              </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Progress
                percent={Math.min(Math.round(project.completion_percentage), 100)}
                size="small"
                showInfo={false}
                strokeColor={COLORS[index % COLORS.length]}
                style={{ width: 80, margin: 0 }}
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                {Math.round(project.completion_percentage)}%
              </Text>
            </div>
          </div>
        );
        })}

        {/* Totals row label */}
        <div
          style={{
            height: rowHeight,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
            borderTop: `2px solid ${theme === 'dark' ? '#434343' : '#d9d9d9'}`,
          }}
        >
          <Text strong style={{ color: '#52c41a' }}>ИТОГО</Text>
        </div>
      </div>

      {/* Chart column - Mini charts */}
      <div
        style={{
          width: chartWidth,
          flexShrink: 0,
          borderRight: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            height: headerHeight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
            background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
          }}
        >
          <Text strong style={{ fontSize: 12 }}>График</Text>
        </div>

        {/* Mini chart rows */}
        {visibleProjects.map((project, index) => {
          const chartData = getProjectChartData(project, index);
          return (
            <div
              key={project.id}
              style={{
                height: rowHeight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '8px',
                borderBottom: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
                background:
                  hoveredProject === project.id
                    ? theme === 'dark'
                      ? '#262626'
                      : '#f5f5f5'
                    : 'transparent',
                transition: 'background 0.2s',
                cursor: chartData ? 'pointer' : 'default',
              }}
              onMouseEnter={() => setHoveredProject(project.id)}
              onMouseLeave={() => setHoveredProject(null)}
              onClick={() => chartData && setChartModalProject({ project, colorIndex: index })}
            >
              {chartData ? (
                <div style={{ width: '100%', height: rowHeight - 20, pointerEvents: 'none' }}>
                  <Line data={chartData} options={miniChartOptions} />
                </div>
              ) : (
                <Text type="secondary" style={{ fontSize: 10 }}>—</Text>
              )}
            </div>
          );
        })}

        {/* Totals row - clickable for summary chart */}
        <div
          style={{
            height: rowHeight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px',
            background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
            borderTop: `2px solid ${theme === 'dark' ? '#434343' : '#d9d9d9'}`,
            cursor: summaryChartData ? 'pointer' : 'default',
          }}
          onClick={() => summaryChartData && setSummaryChartOpen(true)}
        >
          {summaryChartData ? (
            <div style={{ width: '100%', height: rowHeight - 20, pointerEvents: 'none' }}>
              <Line data={summaryChartData} options={miniChartOptions} />
            </div>
          ) : (
            <Text type="secondary" style={{ fontSize: 10 }}>—</Text>
          )}
        </div>
      </div>

      {/* Right panel - Timeline */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        <div style={{ minWidth: gridWidth }}>
          {/* Month headers */}
          <div
            style={{
              display: 'flex',
              height: headerHeight,
              borderBottom: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
              background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
            }}
          >
            {months.map((month) => (
              <div
                key={`${month.year}-${month.month}`}
                style={{
                  width: monthWidth,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRight: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
                  background: month.isCurrent
                    ? theme === 'dark'
                      ? 'rgba(24, 144, 255, 0.2)'
                      : 'rgba(24, 144, 255, 0.1)'
                    : 'transparent',
                }}
              >
                <Text
                  strong={month.isCurrent}
                  type={month.isPast ? 'secondary' : undefined}
                  style={{ fontSize: 12 }}
                >
                  {month.shortLabel}
                </Text>
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {month.year}
                </Text>
              </div>
            ))}
          </div>

          {/* Project rows with bars */}
          {visibleProjects.map((project, projectIndex) => {
            const color = COLORS[projectIndex % COLORS.length];

            return (
              <div
                key={project.id}
                style={{
                  display: 'flex',
                  height: rowHeight,
                  borderBottom: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
                  background:
                    hoveredProject === project.id
                      ? theme === 'dark'
                        ? '#262626'
                        : '#f5f5f5'
                      : 'transparent',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={() => setHoveredProject(project.id)}
                onMouseLeave={() => setHoveredProject(null)}
              >
                {months.map((month) => {
                  const completion = getCompletionForMonth(project.id, month.year, month.month);
                  const hasActual = completion && completion.actual_amount > 0;
                  const hasForecast = completion && !hasActual && completion.forecast_amount && completion.forecast_amount > 0;

                  // Check if month is within project timeline (from contract_date to construction_end_date)
                  const startDate = project.contract_date
                    ? dayjs(project.contract_date)
                    : null;
                  const endDate = project.construction_end_date
                    ? dayjs(project.construction_end_date)
                    : null;
                  const monthDate = dayjs(`${month.year}-${month.month}-01`);

                  const isAfterStart = !startDate || monthDate.isSameOrAfter(startDate, 'month');
                  const isBeforeEnd = !endDate || monthDate.isSameOrBefore(endDate, 'month');
                  const isInRange = isAfterStart && isBeforeEnd;

                  return (
                    <div
                      key={`${month.year}-${month.month}`}
                      style={{
                        width: monthWidth,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRight: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
                        background: month.isCurrent
                          ? theme === 'dark'
                            ? 'rgba(24, 144, 255, 0.1)'
                            : 'rgba(24, 144, 255, 0.05)'
                          : 'transparent',
                        padding: '4px 2px',
                      }}
                    >
                      {hasActual && (
                        <Tooltip
                          title={
                            <div>
                              <div>{month.label}</div>
                              <div>Факт: {formatMoney(completion!.actual_amount)} ₽</div>
                            </div>
                          }
                        >
                          <div
                            style={{
                              width: monthWidth - 8,
                              height: 28,
                              borderRadius: 4,
                              background: color,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 10,
                                color: '#fff',
                                fontWeight: 500,
                              }}
                            >
                              {formatMoney(completion!.actual_amount)}
                            </Text>
                          </div>
                        </Tooltip>
                      )}
                      {hasForecast && (
                        <Tooltip
                          title={
                            <div>
                              <div>{month.label}</div>
                              <div>Прогноз: {formatMoney(completion!.forecast_amount!)} ₽</div>
                            </div>
                          }
                        >
                          <div
                            style={{
                              width: monthWidth - 8,
                              height: 28,
                              borderRadius: 4,
                              background: '#faad14',
                              border: '2px dashed rgba(255, 255, 255, 0.5)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 10,
                                color: '#fff',
                                fontWeight: 500,
                              }}
                            >
                              {formatMoney(completion!.forecast_amount!)}
                            </Text>
                          </div>
                        </Tooltip>
                      )}
                      {!hasActual && !hasForecast && isInRange && startDate && endDate && (
                        <div
                          style={{
                            width: monthWidth - 16,
                            height: 4,
                            borderRadius: 2,
                            background: `${color}20`,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Monthly totals row */}
          <div
            style={{
              display: 'flex',
              height: rowHeight,
              background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
              borderTop: `2px solid ${theme === 'dark' ? '#434343' : '#d9d9d9'}`,
            }}
          >
            {months.map((month) => {
              const key = `${month.year}-${month.month}`;
              const monthTotal = monthlyTotals[key] || 0;

              return (
                <div
                  key={key}
                  style={{
                    width: monthWidth,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRight: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
                    background: month.isCurrent
                      ? theme === 'dark'
                        ? 'rgba(24, 144, 255, 0.15)'
                        : 'rgba(24, 144, 255, 0.1)'
                      : 'transparent',
                  }}
                >
                  {monthTotal > 0 && (
                    <Text strong style={{ fontSize: 10, color: '#52c41a' }}>
                      {formatMoney(monthTotal)}
                    </Text>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </div>

      {/* Totals row */}
      <div
        style={{
          display: 'flex',
          padding: '16px 24px',
          background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
          border: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          gap: 48,
        }}
      >
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>Всего договоров:</Text>{' '}
          <Text strong style={{ color: '#1890ff' }}>{formatMoney(totals.totalContract)} ₽</Text>
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>Закрыто:</Text>{' '}
          <Text strong style={{ color: '#52c41a' }}>{formatMoney(totals.totalCompletion)} ₽</Text>
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>Осталось:</Text>{' '}
          <Text strong style={{ color: '#faad14' }}>{formatMoney(totals.totalRemaining)} ₽</Text>
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>Прогресс:</Text>{' '}
          <Text strong>{Math.round(totals.completionPercent)}%</Text>
        </div>
      </div>

      {/* Chart modal */}
      <Modal
        title={chartModalProject ? `Выполнение: ${chartModalProject.project.name}` : ''}
        open={!!chartModalProject}
        onCancel={() => setChartModalProject(null)}
        footer={null}
        width="90vw"
        style={{ maxWidth: 1800 }}
        destroyOnClose
      >
        {chartModalProject && (
          <div style={{ height: 700 }}>
            {(() => {
              const fullData = getFullProjectChartData(chartModalProject.project, chartModalProject.colorIndex);
              return fullData ? (
                <Line data={fullData} options={fullChartOptions} />
              ) : (
                <Empty description="Нет данных для отображения" />
              );
            })()}
          </div>
        )}
      </Modal>

      {/* Summary chart modal */}
      <Modal
        title="Общее выполнение компании"
        open={summaryChartOpen}
        onCancel={() => setSummaryChartOpen(false)}
        footer={null}
        width="90vw"
        style={{ maxWidth: 1800 }}
        destroyOnClose
      >
        {summaryChartData && (
          <div style={{ height: 700 }}>
            <Line data={summaryChartData} options={summaryChartOptions} />
          </div>
        )}
      </Modal>
    </div>
  );
};
