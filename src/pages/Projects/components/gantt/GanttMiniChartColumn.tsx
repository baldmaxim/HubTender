import React from 'react';
import { Typography } from 'antd';
import { Line } from 'react-chartjs-2';
import type { ProjectFull, ProjectCompletion } from '../../../../lib/supabase/types';
import { getProjectChartData } from './projectChartData';
import { buildSummaryChartData } from './summaryChartData';
import { miniChartOptions } from './chartOptions';
import type { ChartModalTarget } from './ganttUtils';

const { Text } = Typography;

/** Колонка мини-графиков Ганта (по проекту + суммарный, кликабельны в модалки). */
export const GanttMiniChartColumn: React.FC<{
  visibleProjects: ProjectFull[];
  completionData: ProjectCompletion[];
  summaryChartData: ReturnType<typeof buildSummaryChartData>;
  theme: string;
  portrait: boolean;
  landscape: boolean;
  chartWidth: number;
  rowHeight: number;
  headerHeight: number;
  hoveredProject: string | null;
  setHoveredProject: (id: string | null) => void;
  onOpenChartModal: (target: ChartModalTarget) => void;
  onOpenSummaryChart: () => void;
}> = ({
  visibleProjects,
  completionData,
  summaryChartData,
  theme,
  portrait,
  landscape,
  chartWidth,
  rowHeight,
  headerHeight,
  hoveredProject,
  setHoveredProject,
  onOpenChartModal,
  onOpenSummaryChart,
}) => (
  <div
    style={{
      width: portrait ? undefined : chartWidth,
      flex: portrait ? 1 : undefined,
      minWidth: 0,
      flexShrink: 0,
      borderRight: portrait ? 'none' : `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
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
      const chartData = getProjectChartData(project, index, completionData);
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
            cursor: chartData && !landscape ? 'pointer' : 'default',
          }}
          onMouseEnter={() => setHoveredProject(project.id)}
          onMouseLeave={() => setHoveredProject(null)}
          onClick={landscape ? undefined : () => chartData && onOpenChartModal({ project, colorIndex: index })}
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
        cursor: summaryChartData && !landscape ? 'pointer' : 'default',
      }}
      onClick={landscape ? undefined : () => summaryChartData && onOpenSummaryChart()}
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
);
