import React, { useMemo, useState } from 'react';
import { Select, Empty, Space, Typography, Card, Row, Col, Statistic } from 'antd';
import { Column } from '@ant-design/charts';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ProjectFull, ProjectCompletion } from '../../../lib/supabase/types';

dayjs.locale('ru');

const { Text } = Typography;

interface ScheduleChartProps {
  projects: ProjectFull[];
  completionData: ProjectCompletion[];
  onRefresh: () => Promise<void>;
}

interface ChartDataItem {
  month: string;
  project: string;
  amount: number;
  type: 'Факт' | 'Прогноз';
}

const COLORS = {
  fact: '#1890ff',
  forecast: '#faad14',
};

const formatMoney = (value: number): string => {
  if (value >= 1_000_000_000) {
    const billions = value / 1_000_000_000;
    return `${billions.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} млрд`;
  }
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} млн`;
  }
  if (value >= 1_000) {
    return `${value.toLocaleString('ru-RU')}`;
  }
  return value.toLocaleString('ru-RU');
};

export const ScheduleChart: React.FC<ScheduleChartProps> = ({
  projects,
  completionData,
}) => {
  const { theme } = useTheme();
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  // Filter projects
  const filteredProjects = useMemo(() => {
    if (selectedProjectIds.length === 0) return projects;
    return projects.filter((p) => selectedProjectIds.includes(p.id));
  }, [projects, selectedProjectIds]);

  // Generate chart data
  const chartData = useMemo(() => {
    if (filteredProjects.length === 0) return [];

    const data: ChartDataItem[] = [];
    const currentMonth = dayjs().startOf('month');

    // Find date range
    const minDate = currentMonth.subtract(3, 'month');
    let maxDate = currentMonth.add(12, 'month');

    filteredProjects.forEach((project) => {
      if (project.construction_end_date) {
        const endDate = dayjs(project.construction_end_date);
        if (endDate.isAfter(maxDate)) {
          maxDate = endDate;
        }
      }
    });

    // Limit maxDate to reasonable range (max 24 months)
    if (maxDate.diff(minDate, 'month') > 24) {
      maxDate = minDate.add(24, 'month');
    }

    // Generate months
    let month = minDate;
    while (month.isBefore(maxDate) || month.isSame(maxDate, 'month')) {
      const monthLabel = month.format('MMM YY');
      const isFuture = month.isAfter(currentMonth, 'month');
      const isCurrentMonth = month.isSame(currentMonth, 'month');

      filteredProjects.forEach((project) => {
        // Find completion record for this month
        const completion = completionData.find(
          (c) =>
            c.project_id === project.id &&
            c.year === month.year() &&
            c.month === month.month() + 1
        );

        const actualAmount = completion?.actual_amount || 0;
        const forecastAmount = completion?.forecast_amount || 0;

        if (isFuture || isCurrentMonth) {
          // Future/current months - show forecast or planned
          if (forecastAmount > 0) {
            data.push({
              month: monthLabel,
              project: project.name,
              amount: forecastAmount,
              type: 'Прогноз',
            });
          } else if (project.construction_end_date) {
            // Auto-generate planned amount if no forecast entered
            const endDate = dayjs(project.construction_end_date);
            if (month.isBefore(endDate) || month.isSame(endDate, 'month')) {
              // Calculate remaining amount and distribute evenly
              const remainingAmount = project.final_contract_cost - project.total_completion;
              const monthsRemaining = Math.max(1, endDate.diff(currentMonth, 'month') + 1);
              const plannedMonthly = remainingAmount / monthsRemaining;

              if (plannedMonthly > 0) {
                data.push({
                  month: monthLabel,
                  project: project.name,
                  amount: Math.round(plannedMonthly),
                  type: 'Прогноз',
                });
              }
            }
          }
        }

        // Past months - show actual
        if (!isFuture && actualAmount > 0) {
          data.push({
            month: monthLabel,
            project: project.name,
            amount: actualAmount,
            type: 'Факт',
          });
        }
      });

      month = month.add(1, 'month');
    }

    return data;
  }, [filteredProjects, completionData]);

  // Calculate totals for selected projects
  const totals = useMemo(() => {
    const totalContract = filteredProjects.reduce(
      (sum, p) => sum + p.final_contract_cost,
      0
    );
    const totalCompletion = filteredProjects.reduce(
      (sum, p) => sum + p.total_completion,
      0
    );
    const avgPercentage =
      totalContract > 0 ? (totalCompletion / totalContract) * 100 : 0;

    return { totalContract, totalCompletion, avgPercentage };
  }, [filteredProjects]);

  // Chart config
  const config = {
    data: chartData,
    xField: 'month',
    yField: 'amount',
    seriesField: 'project',
    isGroup: true,
    columnStyle: (datum: ChartDataItem) => ({
      fill: datum.type === 'Факт' ? COLORS.fact : COLORS.forecast,
      fillOpacity: datum.type === 'Прогноз' ? 0.5 : 1,
    }),
    label: {
      position: 'top' as const,
      formatter: (datum: ChartDataItem) => formatMoney(datum.amount),
      style: {
        fill: theme === 'dark' ? '#fff' : '#000',
        fontSize: 10,
      },
    },
    legend: {
      position: 'top-right' as const,
      itemName: {
        style: {
          fill: theme === 'dark' ? '#fff' : '#000',
        },
      },
    },
    xAxis: {
      label: {
        style: {
          fill: theme === 'dark' ? '#fff' : '#000',
        },
      },
    },
    yAxis: {
      label: {
        formatter: (v: string) => formatMoney(Number(v)),
        style: {
          fill: theme === 'dark' ? '#fff' : '#000',
        },
      },
    },
    tooltip: {
      formatter: (datum: ChartDataItem) => ({
        name: `${datum.project} (${datum.type})`,
        value: `${datum.amount.toLocaleString('ru-RU')} ₽`,
      }),
    },
    theme: theme === 'dark' ? 'dark' : 'light',
    color: (datum: ChartDataItem) => {
      // Create color palette for different projects
      const projectIndex = filteredProjects.findIndex(
        (p) => p.name === datum.project
      );
      const colors = [
        '#1890ff',
        '#52c41a',
        '#faad14',
        '#722ed1',
        '#eb2f96',
        '#13c2c2',
        '#fa541c',
        '#2f54eb',
      ];
      const baseColor = colors[projectIndex % colors.length];
      return datum.type === 'Прогноз' ? `${baseColor}80` : baseColor;
    },
  };

  if (projects.length === 0) {
    return <Empty description="Нет объектов для отображения" />;
  }

  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <div>
          <Text strong style={{ marginRight: 12 }}>
            Выберите объекты:
          </Text>
          <Select
            mode="multiple"
            allowClear
            placeholder="Все объекты"
            style={{ width: '100%', maxWidth: 600 }}
            value={selectedProjectIds}
            onChange={setSelectedProjectIds}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>

        <Row gutter={16}>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="Итого по договорам"
                value={totals.totalContract}
                precision={0}
                suffix="₽"
                valueStyle={{ color: '#1890ff' }}
                formatter={(value) => formatMoney(Number(value))}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="Закрыто выполнения"
                value={totals.totalCompletion}
                precision={0}
                suffix="₽"
                valueStyle={{ color: '#52c41a' }}
                formatter={(value) => formatMoney(Number(value))}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="Средний % выполнения"
                value={totals.avgPercentage}
                precision={1}
                suffix="%"
                valueStyle={{
                  color: totals.avgPercentage >= 80 ? '#52c41a' : '#faad14',
                }}
              />
            </Card>
          </Col>
        </Row>

        {chartData.length > 0 ? (
          <div
            style={{
              height: 450,
              background: theme === 'dark' ? '#141414' : '#fff',
              padding: 16,
              borderRadius: 8,
            }}
          >
            <Column {...config} />
          </div>
        ) : (
          <Empty description="Нет данных о выполнении для выбранных объектов" />
        )}

        <div style={{ textAlign: 'center' }}>
          <Space>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 16,
                  height: 16,
                  background: COLORS.fact,
                  borderRadius: 2,
                }}
              />
              <Text type="secondary">Фактическое выполнение</Text>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 16,
                  height: 16,
                  background: COLORS.forecast,
                  opacity: 0.5,
                  borderRadius: 2,
                }}
              />
              <Text type="secondary">Прогнозное выполнение</Text>
            </div>
          </Space>
        </div>
      </Space>
    </div>
  );
};
