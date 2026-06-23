/**
 * Закреплённая компактная полоса сводных итогов для ландшафтного оверлея.
 * Зеркалит Table.Summary из CostTable под выбранный режим просмотра.
 */
import React from 'react';
import { Typography } from 'antd';
import type { CostTotals } from '../utils/computeTotals';

const { Text } = Typography;

interface CostTotalsBarProps {
  totals: CostTotals;
  viewMode: 'detailed' | 'summary' | 'simplified';
  areaSp: number;
}

const fmt = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

interface Cell {
  label: string;
  value: string;
  color?: string;
  strong?: boolean;
}

const CostTotalsBar: React.FC<CostTotalsBarProps> = ({ totals, viewMode, areaSp }) => {
  let cells: Cell[];
  if (viewMode === 'simplified') {
    cells = [
      { label: 'Итого', value: fmt(totals.total), color: '#10b981', strong: true },
      { label: 'Итого/м²', value: areaSp ? fmt(totals.total / areaSp) : '—', color: '#0891b2' },
    ];
  } else if (viewMode === 'detailed') {
    cells = [
      { label: 'Мат.', value: fmt(totals.materials + totals.materialsComp) },
      { label: 'Раб.', value: fmt(totals.works + totals.worksComp) },
      { label: 'Суб-мат.', value: fmt(totals.subMaterials) },
      { label: 'Суб-раб.', value: fmt(totals.subWorks) },
      { label: 'Итого', value: fmt(totals.total), color: '#10b981', strong: true },
    ];
  } else {
    cells = [
      { label: 'Раб.', value: fmt(Math.round(totals.totalWorks)), color: '#0891b2' },
      { label: 'Мат.', value: fmt(totals.totalMaterials), color: '#059669' },
      { label: 'Итого', value: fmt(totals.total), color: '#10b981', strong: true },
    ];
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

export default CostTotalsBar;
