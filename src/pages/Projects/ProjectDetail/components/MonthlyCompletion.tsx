import React, { useMemo, useState } from 'react';
import {
  Table,
  InputNumber,
  Input,
  Button,
  Space,
  Typography,
  message,
  Progress,
  Card,
  Row,
  Col,
  Statistic,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { supabase } from '../../../../lib/supabase';
import type { ProjectFull, ProjectCompletion } from '../../../../lib/supabase/types';

const { Text } = Typography;

interface MonthlyCompletionProps {
  project: ProjectFull;
  completionData: ProjectCompletion[];
  onSave: () => Promise<void>;
}

interface MonthRow {
  key: string;
  year: number;
  month: number;
  monthLabel: string;
  shortLabel: string;
  actual_amount: number;
  forecast_amount: number | null;
  note: string | null;
  existingId: string | null;
  isModified: boolean;
  isPast: boolean;
  isCurrent: boolean;
}

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const MONTH_SHORT = [
  'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
  'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
];

// Правильное форматирование денежных сумм
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

export const MonthlyCompletion: React.FC<MonthlyCompletionProps> = ({
  project,
  completionData,
  onSave,
}) => {
  const [loading, setLoading] = useState(false);
  const [modifiedRows, setModifiedRows] = useState<Record<string, Partial<MonthRow>>>({});

  // Generate months based on construction dates and existing completion data
  const monthRows = useMemo(() => {
    const rows: MonthRow[] = [];
    const now = dayjs();
    const currentYear = now.year();
    const currentMonth = now.month() + 1;

    let startDate = project.contract_date
      ? dayjs(project.contract_date).startOf('month')
      : dayjs().subtract(6, 'month').startOf('month');

    let endDate = project.construction_end_date
      ? dayjs(project.construction_end_date).endOf('month')
      : dayjs().add(12, 'month').endOf('month');

    completionData.forEach((c) => {
      const completionDate = dayjs(`${c.year}-${c.month}-01`);
      if (completionDate.isBefore(startDate)) {
        startDate = completionDate.startOf('month');
      }
      if (completionDate.isAfter(endDate)) {
        endDate = completionDate.endOf('month');
      }
    });

    const maxMonths = 48;
    if (endDate.diff(startDate, 'month') > maxMonths) {
      endDate = startDate.add(maxMonths, 'month');
    }

    let current = startDate;
    while (current.isBefore(endDate) || current.isSame(endDate, 'month')) {
      const year = current.year();
      const month = current.month() + 1;
      const key = `${year}-${month}`;

      const existing = completionData.find((c) => c.year === year && c.month === month);

      const isPast = year < currentYear || (year === currentYear && month < currentMonth);
      const isCurrent = year === currentYear && month === currentMonth;

      rows.push({
        key,
        year,
        month,
        monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
        shortLabel: `${MONTH_SHORT[month - 1]} ${year.toString().slice(-2)}`,
        actual_amount: existing?.actual_amount || 0,
        forecast_amount: existing?.forecast_amount || null,
        note: existing?.note || null,
        existingId: existing?.id || null,
        isModified: false,
        isPast,
        isCurrent,
      });

      current = current.add(1, 'month');
    }

    return rows;
  }, [project.contract_date, project.construction_end_date, completionData]);

  const displayRows = useMemo(() => {
    return monthRows.map((row) => ({
      ...row,
      ...modifiedRows[row.key],
      isModified: !!modifiedRows[row.key],
    }));
  }, [monthRows, modifiedRows]);

  const totals = useMemo(() => {
    const actualTotal = displayRows.reduce((sum, r) => sum + (r.actual_amount || 0), 0);
    const forecastTotal = displayRows.reduce((sum, r) => sum + (r.forecast_amount || 0), 0);
    return { actualTotal, forecastTotal };
  }, [displayRows]);

  const handleCellChange = (key: string, field: keyof MonthRow, value: number | string | null) => {
    setModifiedRows((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  };

  const handleSaveAll = async () => {
    const modifiedKeys = Object.keys(modifiedRows);
    if (modifiedKeys.length === 0) {
      message.info('Нет изменений для сохранения');
      return;
    }

    setLoading(true);
    try {
      for (const key of modifiedKeys) {
        const row = displayRows.find((r) => r.key === key);
        if (!row) continue;

        const data = {
          project_id: project.id,
          year: row.year,
          month: row.month,
          actual_amount: row.actual_amount || 0,
          forecast_amount: row.forecast_amount || null,
          note: row.note || null,
        };

        if (row.existingId) {
          const { error } = await supabase
            .from('project_monthly_completion')
            .update({
              actual_amount: data.actual_amount,
              forecast_amount: data.forecast_amount,
              note: data.note,
            })
            .eq('id', row.existingId);

          if (error) throw error;
        } else {
          const { error } = await supabase.from('project_monthly_completion').insert([data]);

          if (error) throw error;
        }
      }

      message.success('Данные сохранены');
      setModifiedRows({});
      await onSave();
    } catch (error) {
      console.error('Error saving completion:', error);
      message.error('Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  const parseNumber = (value: string | undefined): number => {
    if (!value) return 0;
    const normalized = value.replace(/\s/g, '').replace(',', '.');
    const parsed = parseFloat(normalized);
    return isNaN(parsed) ? 0 : parsed;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowedKeys = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    const isNumber = /^[0-9]$/.test(e.key);
    const isDecimalSeparator = e.key === '.' || e.key === ',';
    const isCtrlCmd = e.ctrlKey || e.metaKey;

    if (!isNumber && !isDecimalSeparator && !allowedKeys.includes(e.key) && !isCtrlCmd) {
      e.preventDefault();
    }
  };

  const columns: ColumnsType<MonthRow> = [
    {
      title: 'Месяц',
      dataIndex: 'monthLabel',
      key: 'monthLabel',
      width: 150,
      fixed: 'left',
      render: (label: string, record) => (
        <Text
          strong={record.isCurrent}
          type={record.isPast ? undefined : 'secondary'}
          style={record.isCurrent ? { color: '#1890ff' } : undefined}
        >
          {label}
          {record.isCurrent && ' (текущий)'}
        </Text>
      ),
    },
    {
      title: 'Факт выполнения (₽)',
      dataIndex: 'actual_amount',
      key: 'actual_amount',
      width: 200,
      render: (value: number, record) => (
        <InputNumber
          value={value}
          min={0 as number}
          precision={2}
          decimalSeparator=","
          style={{ width: '100%' }}
          formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
          parser={parseNumber}
          onChange={(v) => handleCellChange(record.key, 'actual_amount', v || 0)}
          status={record.isModified ? 'warning' : undefined}
          controls={false}
          onKeyDown={handleKeyDown}
        />
      ),
    },
    {
      title: 'Прогноз (₽)',
      dataIndex: 'forecast_amount',
      key: 'forecast_amount',
      width: 200,
      render: (value: number | null, record) => (
        <InputNumber
          value={value}
          min={0 as number}
          precision={2}
          decimalSeparator=","
          style={{ width: '100%' }}
          placeholder="—"
          formatter={(v) => (v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '')}
          parser={(v) => (v ? parseNumber(v) : null)}
          onChange={(v) => handleCellChange(record.key, 'forecast_amount', v)}
          status={record.isModified ? 'warning' : undefined}
          controls={false}
          onKeyDown={handleKeyDown}
        />
      ),
    },
    {
      title: 'Примечание',
      dataIndex: 'note',
      key: 'note',
      render: (value: string | null, record) => (
        <Input
          value={value || ''}
          placeholder="—"
          onChange={(e) => handleCellChange(record.key, 'note', e.target.value || null)}
          style={record.isModified ? { borderColor: '#faad14' } : undefined}
        />
      ),
    },
  ];

  const remainingAmount = project.final_contract_cost - totals.actualTotal;
  const progressPercent = project.final_contract_cost > 0
    ? Math.round((totals.actualTotal / project.final_contract_cost) * 100)
    : 0;

  return (
    <div>
      {/* Summary */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Итого договор"
              value={project.final_contract_cost}
              formatter={() => formatMoney(project.final_contract_cost)}
              valueStyle={{ color: '#1890ff', fontSize: 16 }}
              suffix="₽"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Закрыто (факт)"
              value={totals.actualTotal}
              formatter={() => formatMoney(totals.actualTotal)}
              valueStyle={{ color: '#52c41a', fontSize: 16 }}
              suffix="₽"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Осталось"
              value={remainingAmount}
              formatter={() => formatMoney(remainingAmount)}
              valueStyle={{ color: remainingAmount > 0 ? '#faad14' : '#52c41a', fontSize: 16 }}
              suffix="₽"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Text type="secondary" style={{ fontSize: 12 }}>
              Общий прогресс
            </Text>
            <Progress
              percent={progressPercent}
              status={progressPercent >= 100 ? 'success' : 'active'}
              style={{ marginTop: 8 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Actions */}
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSaveAll}
          loading={loading}
          disabled={Object.keys(modifiedRows).length === 0}
        >
          Сохранить изменения ({Object.keys(modifiedRows).length})
        </Button>
      </Space>

      {/* Table */}
      <Table
        columns={columns}
        dataSource={displayRows}
        rowKey="key"
        pagination={false}
        scroll={{ x: 750, y: 'calc(100vh - 490px)' }}
        size="small"
        rowClassName={(record) => (record.isCurrent ? 'current-month-row' : '')}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <Text strong>ИТОГО</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1}>
                <Text strong style={{ color: '#52c41a' }}>
                  {formatMoney(totals.actualTotal)} ₽
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2}>
                <Text strong style={{ color: '#faad14' }}>
                  {totals.forecastTotal ? `${formatMoney(totals.forecastTotal)} ₽` : '—'}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} />
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />

      <style>{`
        .current-month-row {
          background-color: rgba(24, 144, 255, 0.1) !important;
        }
        .current-month-row:hover > td {
          background-color: rgba(24, 144, 255, 0.15) !important;
        }
      `}</style>
    </div>
  );
};
