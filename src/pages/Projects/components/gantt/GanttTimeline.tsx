import React from 'react';
import { Typography, Tooltip } from 'antd';
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import type { ProjectFull, ProjectCompletion } from '../../../../lib/supabase/types';
import { COLORS, formatMoney, type MonthData } from './ganttUtils';

// Плагины идемпотентны — повторное extend безопасно.
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

const { Text } = Typography;

/** Правая панель Ганта: шапка месяцев, бары факт/прогноз по проектам и
 *  строка месячных итогов. */
export const GanttTimeline: React.FC<{
  scrollRef: React.RefObject<HTMLDivElement>;
  visibleProjects: ProjectFull[];
  months: MonthData[];
  monthWidth: number;
  gridWidth: number;
  rowHeight: number;
  headerHeight: number;
  theme: string;
  portrait: boolean;
  tapToOpen: boolean;
  onRequestLandscape?: () => void;
  hoveredProject: string | null;
  setHoveredProject: (id: string | null) => void;
  getCompletionForMonth: (projectId: string, year: number, month: number) => ProjectCompletion | undefined;
  monthlyTotals: Record<string, number>;
}> = ({
  scrollRef,
  visibleProjects,
  months,
  monthWidth,
  gridWidth,
  rowHeight,
  headerHeight,
  theme,
  portrait,
  tapToOpen,
  onRequestLandscape,
  hoveredProject,
  setHoveredProject,
  getCompletionForMonth,
  monthlyTotals,
}) => (
  <div
    ref={scrollRef}
    onClick={tapToOpen ? onRequestLandscape : undefined}
    style={{
      // В портрете на телефоне таймлайн с цифрами скрыт (показывается при повороте).
      display: portrait ? 'none' : undefined,
      flex: 1,
      overflowX: 'auto',
      overflowY: 'hidden',
      cursor: tapToOpen ? 'pointer' : undefined,
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
                            whiteSpace: 'nowrap',
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
                            whiteSpace: 'nowrap',
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
                <Text strong style={{ fontSize: 10, color: '#52c41a', whiteSpace: 'nowrap' }}>
                  {formatMoney(monthTotal)}
                </Text>
              )}
            </div>
          );
        })}
      </div>
    </div>
  </div>
);
