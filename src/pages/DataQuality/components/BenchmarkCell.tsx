import React from 'react';
import { Space, Tag, Tooltip, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { BenchmarkAssessment } from '../../../lib/api/costBenchmarks';
import { referenceRangeText, sourceLabel, statusDisplay } from '../../../lib/quality/costBenchmarkPolicy';

const { Text } = Typography;

const money = (v: number): string => Math.round(v).toLocaleString('ru-RU');

/** Значение показателя, эталон и статус в одной ячейке. */
export const BenchmarkCell: React.FC<{ a: BenchmarkAssessment | null }> = ({ a }) => {
  if (!a) return <Text type="secondary">—</Text>;
  const st = statusDisplay(a.status);
  const ref = a.reference;
  const dev = a.deviation_percent;

  const tooltip = ref
    ? [
        `Эталон: ${referenceRangeText(ref)} (${sourceLabel(ref)})`,
        ref.median !== undefined ? `медиана ${money(ref.median)}` : null,
        ref.note ? `примечание: ${ref.note}` : null,
        a.history_conflict && a.history_median !== null
          ? `история своего класса (${a.history_tenders} тенд.) даёт медиану ${money(a.history_median)} — вне диапазона справочника`
          : null,
      ].filter(Boolean).join('; ')
    : undefined;

  return (
    <Space direction="vertical" size={0}>
      <Text strong={a.status === 'ABOVE_RANGE' || a.status === 'BELOW_RANGE'}>
        {a.value !== null ? money(a.value) : '—'}
      </Text>
      <Tooltip title={tooltip}>
        <Space size={4} wrap>
          <Tag color={st.color} style={{ marginInlineEnd: 0 }}>
            {st.text}
            {dev !== null && (a.status === 'ABOVE_RANGE' || a.status === 'BELOW_RANGE')
              ? ` ${dev > 0 ? '+' : ''}${dev}%`
              : ''}
          </Tag>
          {a.history_conflict && <WarningOutlined style={{ color: '#faad14' }} />}
        </Space>
      </Tooltip>
      {ref && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          эталон {referenceRangeText(ref)}
        </Text>
      )}
    </Space>
  );
};
