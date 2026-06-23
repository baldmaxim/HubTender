/**
 * Закреплённая компактная полоса сводных итогов КП для ландшафтного оверлея.
 * Зеркалит Table.Summary из CommerceTable.
 */
import React from 'react';
import { Typography } from 'antd';
import type { CommerceTotals } from '../utils/computeCommerceTotals';
import { formatCommercialCost } from '../../../utils/markupCalculator';

const { Text } = Typography;

interface CommerceTotalsBarProps {
  totals: CommerceTotals;
  insuranceTotal: number;
}

interface Cell {
  label: string;
  value: string;
  color?: string;
  strong?: boolean;
}

const CommerceTotalsBar: React.FC<CommerceTotalsBarProps> = ({ totals, insuranceTotal }) => {
  const cells: Cell[] = [
    {
      label: 'Базовая',
      value: formatCommercialCost(totals.totalBase),
      color: totals.baseTotalMatches ? '#52c41a' : '#ff4d4f',
    },
    { label: `Мат. (${totals.materialPercent}%)`, value: formatCommercialCost(totals.totalMaterials), color: '#1890ff' },
    { label: `Раб. (${totals.workPercent}%)`, value: formatCommercialCost(totals.totalWorksWithIns), color: '#52c41a' },
    { label: 'Коммерч.', value: formatCommercialCost(totals.totalCommercialWithIns), color: '#52c41a', strong: true },
    { label: 'Коэфф.', value: totals.totalMarkupCoefficient.toFixed(4) },
  ];
  if (insuranceTotal > 0) {
    cells.push({ label: 'Страх.', value: formatCommercialCost(insuranceTotal), color: '#10b981' });
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '4px 16px',
        padding: '6px 10px',
        fontSize: 12,
      }}
    >
      <Text strong style={{ fontSize: 12 }}>
        Итого:
      </Text>
      {cells.map((cell) => (
        <span key={cell.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {cell.label}
          </Text>
          <Text strong={cell.strong} style={{ fontSize: cell.strong ? 14 : 12, color: cell.color }}>
            {cell.value}
          </Text>
        </span>
      ))}
    </div>
  );
};

export default CommerceTotalsBar;
