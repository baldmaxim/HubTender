/**
 * Карточный (read-only) вид таблицы КП для телефона в портрете.
 * Расчёт долей/итогов повторяет CommerceTable намеренно — десктопная таблица
 * покрыта тестом консистентности, её summary не трогаем.
 */

import { Card, Tag, Typography, Empty, Space } from 'antd';
import type { PositionWithCommercialCost } from '../types';
import { formatCommercialCost } from '../../../utils/markupCalculator';

const { Text } = Typography;

interface CommerceCardsProps {
  positions: PositionWithCommercialCost[];
  insuranceTotal?: number;
  onNavigateToPosition: (positionId: string) => void;
  selectedTenderId: string | undefined;
}

const Metric: React.FC<{ label: string; value: string; color?: string; strong?: boolean }> = ({
  label,
  value,
  color,
  strong,
}) => (
  <div style={{ minWidth: 0 }}>
    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{label}</Text>
    <Text strong={strong} style={{ fontSize: 13, color, wordBreak: 'break-word' }}>{value}</Text>
  </div>
);

export default function CommerceCards({
  positions,
  insuranceTotal = 0,
  onNavigateToPosition,
  selectedTenderId,
}: CommerceCardsProps) {
  if (!positions.length) {
    return <Empty description="Нет позиций заказчика" />;
  }

  let totalWorks = 0;
  let totalBase = 0;
  let totalMaterials = 0;
  let totalCommercial = 0;
  for (const p of positions) {
    totalWorks += p.work_cost_total || 0;
    totalBase += p.base_total || 0;
    totalMaterials += p.material_cost_total || 0;
    totalCommercial += p.commercial_total || 0;
  }
  const insShare = (pos: PositionWithCommercialCost) => {
    if (pos.insurance_share != null) return pos.insurance_share;
    return totalWorks > 0 ? insuranceTotal * ((pos.work_cost_total || 0) / totalWorks) : 0;
  };
  const totalWorksWithIns = totalWorks + insuranceTotal;
  const totalCommercialWithIns = totalCommercial + insuranceTotal;

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {positions.map((record) => {
        const isLeaf = record.is_leaf ?? true;
        const itemNoColor = isLeaf ? '#52c41a' : '#ff7875';
        const ins = insShare(record);
        const workCost = (record.work_cost_total || 0) + ins;
        const matCost = record.material_cost_total || 0;
        const commercial = (record.commercial_total || 0) + ins;
        const coeff = record.markup_percentage || 1;
        return (
          <Card
            key={record.id}
            size="small"
            hoverable={isLeaf}
            onClick={() => {
              if (isLeaf && selectedTenderId) onNavigateToPosition(record.id);
            }}
            styles={{ body: { padding: 12 } }}
            style={{ cursor: isLeaf ? 'pointer' : 'default', borderLeft: `3px solid ${isLeaf ? '#52c41a' : '#ff7875'}` }}
          >
            <div style={{ fontWeight: 500, marginBottom: 8 }}>
              {record.is_additional ? (
                <Tag color="orange">ДОП</Tag>
              ) : record.position_number ? (
                <Tag color="blue">{record.position_number}</Tag>
              ) : null}
              {record.item_no && (
                <span style={{ marginRight: 6, color: itemNoColor, fontWeight: 600 }}>{record.item_no}</span>
              )}
              <span style={{ textDecoration: isLeaf ? 'underline' : 'none', fontWeight: isLeaf ? undefined : 700 }}>
                {record.work_name}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
              <Metric label="Кол-во" value={`${record.manual_volume || 0} ${record.unit_code || ''}`} />
              <Metric label="Базовая" value={formatCommercialCost(record.base_total || 0)} />
              <Metric label="Итого мат. (КП)" value={formatCommercialCost(matCost)} color="#1890ff" />
              <Metric label="Итого раб. (КП)" value={formatCommercialCost(workCost)} color="#52c41a" />
              <Metric label="Коммерческая" value={formatCommercialCost(commercial)} color="#52c41a" strong />
              <div>
                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Коэфф.</Text>
                <Tag color={coeff > 1 ? 'green' : coeff < 1 ? 'red' : 'default'}>{coeff.toFixed(4)}</Tag>
              </div>
            </div>
          </Card>
        );
      })}

      <Card size="small" styles={{ body: { padding: 12 } }} style={{ borderLeft: '3px solid #10b981' }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>Итого:</Text>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
          <Metric label="Базовая" value={formatCommercialCost(totalBase)} strong />
          <Metric label="Материалы (КП)" value={formatCommercialCost(totalMaterials)} color="#1890ff" strong />
          <Metric label="Работы (КП)" value={formatCommercialCost(totalWorksWithIns)} color="#52c41a" strong />
          <Metric label="Коммерческая" value={formatCommercialCost(totalCommercialWithIns)} color="#52c41a" strong />
          {insuranceTotal > 0 && (
            <Metric label="в т.ч. страхование" value={formatCommercialCost(insuranceTotal)} color="#10b981" />
          )}
          <Metric label="Коэфф." value={(totalBase > 0 ? totalCommercialWithIns / totalBase : 1).toFixed(4)} strong />
        </div>
      </Card>
    </Space>
  );
}
