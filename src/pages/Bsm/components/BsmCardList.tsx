import React from 'react';
import { Card, Tag, Typography, Empty, Spin, Space } from 'antd';
import type { BoqItemData } from '../types';
import { getUnitColor, getItemTypeStyle, getMaterialTypeStyle } from '../utils/bsmStyles';

const { Text, Link } = Typography;

interface BsmCardListProps {
  items: BoqItemData[];
  loading: boolean;
}

/** Карточный (read-only) вид БСМ для телефона в портрете. */
export const BsmCardList: React.FC<BsmCardListProps> = ({ items, loading }) => {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  }
  if (items.length === 0) {
    return <Empty description="Нет позиций" style={{ padding: 40 }} />;
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {items.map((item) => {
        const typeStyle = getItemTypeStyle(item.boq_item_type);
        const matStyle = getMaterialTypeStyle(item.material_type);
        return (
          <Card key={item.id} size="small" styles={{ body: { padding: 12 } }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <Tag style={{ backgroundColor: typeStyle.backgroundColor, color: typeStyle.color, border: 'none', margin: 0 }}>
                {item.boq_item_type}
              </Tag>
              {item.material_type && (
                <Tag style={{ backgroundColor: matStyle.backgroundColor, color: matStyle.color, border: 'none', margin: 0, fontSize: 11 }}>
                  {item.material_type}
                </Tag>
              )}
              {item.unit_code && (
                <Tag color={getUnitColor(item.unit_code)} style={{ margin: 0 }}>{item.unit_code}</Tag>
              )}
            </div>

            <Text strong style={{ display: 'block', wordBreak: 'break-word', marginBottom: 6 }}>{item.name}</Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>{item.expense_label || '—'}</Text>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12 }}>
              <div><Text type="secondary">Кол-во: </Text><Text>{item.total_quantity.toFixed(2)}</Text></div>
              <div><Text type="secondary">Позиций: </Text><Text>{item.usage_count}</Text></div>
              <div><Text type="secondary">Цена/ед.: </Text><Text>{item.price_per_unit.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</Text></div>
              <div><Text type="secondary">Сумма: </Text><Text strong>{Math.round(item.total_amount).toLocaleString('ru-RU')}</Text></div>
            </div>

            {item.quote_link && (
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <Text type="secondary">КП: </Text>
                <Link href={item.quote_link} target="_blank" ellipsis>{item.quote_link}</Link>
              </div>
            )}
          </Card>
        );
      })}
    </Space>
  );
};
