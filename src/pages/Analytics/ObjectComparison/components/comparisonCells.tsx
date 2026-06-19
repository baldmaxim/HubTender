import React, { useState, useEffect } from 'react';
import { Input, Space, Typography } from 'antd';
import type { ComparisonRow } from '../types';
import { formatNum } from '../utils/comparisonFormat';

const { Text } = Typography;

export const DiffCell: React.FC<{ value: number; percent: number; bold?: boolean }> = ({ value, percent, bold }) => (
  <Space direction="vertical" size={0}>
    <Text strong={bold} style={{ color: value >= 0 ? '#52c41a' : '#ff4d4f' }}>
      {formatNum(value)}
    </Text>
    <Text type="secondary" style={{ fontSize: '12px' }}>
      ({percent >= 0 ? '+' : ''}{percent.toFixed(1)}%)
    </Text>
  </Space>
);

export const DiffPerUnitCell: React.FC<{ value: number }> = ({ value }) => {
  if (value === 0) return <Text>—</Text>;
  return (
    <Text style={{ color: value >= 0 ? '#52c41a' : '#ff4d4f' }}>
      {value >= 0 ? '+' : ''}{value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </Text>
  );
};

/**
 * Ячейка примечания. Контролируемый компонент с локальным состоянием и
 * стабильным key (=record.key) на уровне рендера: благодаря этому ввод не
 * сбрасывается и не теряет фокус при перерисовках таблицы (серверный
 * авто-пересчёт + realtime-обновления пересобирают comparisonData). Сохраняем
 * на blur, только если значение изменилось.
 */
export const NoteCell: React.FC<{
  record: ComparisonRow;
  onSave: (record: ComparisonRow, value: string) => void;
}> = ({ record, onSave }) => {
  const initial = record.note || '';
  const [value, setValue] = useState(initial);

  // Подтягиваем внешнее значение, только когда оно реально поменялось
  // (своё сохранение, чужая правка). Незавершённый ввод не затирается, т.к.
  // record.note в этот момент остаётся прежним.
  useEffect(() => {
    setValue(record.note || '');
  }, [record.note, record.key]);

  return (
    <Input.TextArea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if ((record.note || '') !== value) {
          onSave(record, value);
        }
      }}
      autoSize={{ minRows: 1, maxRows: 3 }}
      placeholder="—"
      variant="borderless"
      style={{ padding: '2px 4px', fontSize: '13px' }}
    />
  );
};
