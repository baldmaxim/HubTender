import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Typography, Empty, Button, Modal, App } from 'antd';
import { DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import { Line } from 'react-chartjs-2';
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
import { useIsMobile } from '../../../hooks/useIsMobile';
import type { ProjectFull, ProjectCompletion } from '../../../lib/types/types';
import { getErrorMessage } from '../../../utils/errors';
import { AutoFitText } from '../../../components/AutoFitText/AutoFitText';
import {
  MONTH_NAMES_SHORT,
  formatMoney,
  type MonthData,
  type ChartModalTarget,
} from './gantt/ganttUtils';
import { getFullProjectChartData } from './gantt/projectChartData';
import { buildSummaryChartData } from './gantt/summaryChartData';
import { buildFullChartOptions, buildSummaryChartOptions } from './gantt/chartOptions';
import { exportGanttCompletion } from './gantt/exportGanttExcel';
import { GanttLeftPanel } from './gantt/GanttLeftPanel';
import { GanttMiniChartColumn } from './gantt/GanttMiniChartColumn';
import { GanttTimeline } from './gantt/GanttTimeline';

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

// Данные графиков / опции / Excel-экспорт / панели вынесены в ./gantt/*
// (лимит ≤600 строк на файл); здесь — state, memos и композиция.

interface GanttChartProps {
  projects: ProjectFull[];
  completionData: ProjectCompletion[];
  /** Рендер внутри псевдо-ландшафт-оверлея: широкая (не-phone) раскладка, без детальных модалок. */
  landscape?: boolean;
  /** Колбэк «открыть на весь экран» (портретный телефон): тап по графику → ландшафт. */
  onRequestLandscape?: () => void;
}

export const GanttChart: React.FC<GanttChartProps> = ({
  projects,
  completionData,
  landscape = false,
  onRequestLandscape,
}) => {
  const { theme } = useTheme();
  const { message } = App.useApp();
  const { isPhone: isPhoneRaw, isLandscapePhone } = useIsMobile();
  // В ландшафт-оверлее верстаем как «не телефон» (monthWidth 80 и т.д.) → числа влезают.
  const isPhone = isPhoneRaw && !landscape;
  // В ландшафте телефона знак ₽ в итогах убираем (экономия места).
  const rubleSuffix = isLandscapePhone ? '' : ' ₽';
  // Тап по графику открывает ландшафт только у портретного телефонного инстанса.
  const tapToOpen = !!onRequestLandscape && isPhoneRaw && !landscape;

  // Ориентация: в портрете на телефоне прячем правую таймлайн-панель с цифрами,
  // оставляя имя объекта + мини-график; при повороте (ландшафт) показываем всё.
  const [isLandscapeOrient, setIsLandscapeOrient] = useState(
    typeof window !== 'undefined' && !!window.matchMedia
      ? window.matchMedia('(orientation: landscape)').matches
      : true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => setIsLandscapeOrient(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  // Портрет на телефоне (вне ландшафт-оверлея) → компактный режим без таймлайна.
  const portrait = isPhone && !isLandscapeOrient;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [chartModalProject, setChartModalProject] = useState<ChartModalTarget | null>(null);
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
  const { months, monthWidth: baseMonthWidth } = useMemo(() => {
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

  // На телефоне ужимаем ширину месяца, чтобы таймлайну осталось место
  const monthWidth = isPhone ? 56 : baseMonthWidth;

  // Calculate totals across all visible projects
  const totals = useMemo(() => {
    const totalContract = visibleProjects.reduce((sum, p) => sum + (p.final_contract_cost ?? 0), 0);
    const totalCompletion = visibleProjects.reduce((sum, p) => sum + (p.total_completion ?? 0), 0);
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

  const fullChartOptions = useMemo(() => buildFullChartOptions(theme), [theme]);
  const summaryChartOptions = useMemo(() => buildSummaryChartOptions(theme), [theme]);

  // Summary chart data - monthly totals across all visible projects (actual + forecast)
  const summaryChartData = useMemo(
    () => buildSummaryChartData(visibleProjects, completionData),
    [completionData, visibleProjects],
  );

  // Export completion data to Excel (only visible projects)
  const handleExport = () => {
    try {
      exportGanttCompletion({
        visibleProjects,
        months,
        getCompletion: getCompletionForMonth,
      });
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

  // На телефоне ужимаем фиксированные колонки, чтобы таймлайну осталось место
  const rowHeight = 70;
  const headerHeight = 60;
  const projectNameWidth = isPhone ? 128 : 200;
  const chartWidth = isPhone ? 84 : 150;
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
        {!isPhone && !isLandscapePhone && (
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleExport}
          >
            Экспорт в Excel
          </Button>
        )}
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
        <GanttLeftPanel
          visibleProjects={visibleProjects}
          theme={theme}
          portrait={portrait}
          projectNameWidth={projectNameWidth}
          rowHeight={rowHeight}
          headerHeight={headerHeight}
          hoveredProject={hoveredProject}
          setHoveredProject={setHoveredProject}
          hideProject={hideProject}
        />

        {/* Chart column - Mini charts (в портрете растягивается на освободившееся место) */}
        <GanttMiniChartColumn
          visibleProjects={visibleProjects}
          completionData={completionData}
          summaryChartData={summaryChartData}
          theme={theme}
          portrait={portrait}
          landscape={landscape}
          chartWidth={chartWidth}
          rowHeight={rowHeight}
          headerHeight={headerHeight}
          hoveredProject={hoveredProject}
          setHoveredProject={setHoveredProject}
          onOpenChartModal={setChartModalProject}
          onOpenSummaryChart={() => setSummaryChartOpen(true)}
        />

        {/* Right panel - Timeline */}
        <GanttTimeline
          scrollRef={scrollRef}
          visibleProjects={visibleProjects}
          months={months}
          monthWidth={monthWidth}
          gridWidth={gridWidth}
          rowHeight={rowHeight}
          headerHeight={headerHeight}
          theme={theme}
          portrait={portrait}
          tapToOpen={tapToOpen}
          onRequestLandscape={onRequestLandscape}
          hoveredProject={hoveredProject}
          setHoveredProject={setHoveredProject}
          getCompletionForMonth={getCompletionForMonth}
          monthlyTotals={monthlyTotals}
        />
      </div>

      {/* Totals row — итоговая статистика */}
      {isPhone ? (
        // Телефон: 2×2, суммы авто-подгоняются в одну строку (AutoFitText),
        // «Всего договоров» может занять 2 строки, прочий текст — 1 строку.
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            padding: '10px 12px',
            background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
            border: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
          }}
        >
          {[
            { label: 'Всего договоров', value: `${formatMoney(totals.totalContract)}${rubleSuffix}`, color: '#1890ff' },
            { label: 'Закрыто', value: `${formatMoney(totals.totalCompletion)}${rubleSuffix}`, color: '#52c41a' },
            { label: 'Осталось', value: `${formatMoney(totals.totalRemaining)}${rubleSuffix}`, color: '#faad14' },
            { label: 'Прогресс', value: `${Math.round(totals.completionPercent)}%`, color: '#52c41a' },
          ].map((m) => (
            <div key={m.label} style={{ minWidth: 0 }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', lineHeight: 1.15 }}>{m.label}</Text>
              <AutoFitText maxFontSize={16} minFontSize={9} align="left" strong color={m.color}>
                {m.value}
              </AutoFitText>
            </div>
          ))}
        </div>
      ) : (
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
            <Text strong style={{ color: '#1890ff' }}>{formatMoney(totals.totalContract)}{rubleSuffix}</Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Закрыто:</Text>{' '}
            <Text strong style={{ color: '#52c41a' }}>{formatMoney(totals.totalCompletion)}{rubleSuffix}</Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Осталось:</Text>{' '}
            <Text strong style={{ color: '#faad14' }}>{formatMoney(totals.totalRemaining)}{rubleSuffix}</Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Прогресс:</Text>{' '}
            <Text strong>{Math.round(totals.completionPercent)}%</Text>
          </div>
        </div>
      )}

      {/* Chart modal */}
      <Modal
        title={chartModalProject ? `Выполнение: ${chartModalProject.project.name}` : ''}
        open={!!chartModalProject}
        onCancel={() => setChartModalProject(null)}
        footer={null}
        width="90vw"
        style={{ maxWidth: 1800 }}
        centered={isLandscapePhone}
        destroyOnClose
      >
        {chartModalProject && (
          <div style={{ height: isLandscapePhone ? 'calc(100dvh - 120px)' : 700 }}>
            {(() => {
              const fullData = getFullProjectChartData(chartModalProject.project, chartModalProject.colorIndex, completionData);
              return fullData ? (
                <Line data={fullData} options={fullChartOptions as never} />
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
        centered={isLandscapePhone}
        destroyOnClose
      >
        {summaryChartData && (
          <div style={{ height: isLandscapePhone ? 'calc(100dvh - 120px)' : 700 }}>
            <Line data={summaryChartData} options={summaryChartOptions as never} />
          </div>
        )}
      </Modal>
    </div>
  );
};
