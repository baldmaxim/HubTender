import { useMemo } from 'react';
import { Card, Space, Tag, Typography, Empty, Skeleton } from 'antd';
import { LinkOutlined, RightOutlined } from '@ant-design/icons';
import type { BoqItemFull } from '../../../lib/types';
import { currencySymbols, getBoqTypeTagStyle, isMaterialType } from './boqColors';
import { formatRu } from '../../../utils/format/currency';
import { useIncrementalRender } from '../../../hooks/useIncrementalRender';

const { Text } = Typography;

interface ItemsMobileCardsProps {
  items: BoqItemFull[];
  totalSum: number | null;
  /** Пока строки летят, показываем скелетон, а не «Нет элементов»: шапка гидратируется из
   *  positionRowCache мгновенно, поэтому без этого гейта пользователь видел бы уверенное
   *  «позиция пуста» + «Итого: —» на всё время загрузки. */
  loading?: boolean;
  /** Тап по карточке → лист редактирования. Не задан ⇒ карточки некликабельны. */
  onItemClick?: (item: BoqItemFull) => void;
  /** Ключ сброса инкрементального рендера: рефетч после каждого сохранения отдаёт
   *  новый массив, и на идентичности пользователя выкидывало бы к первым 40 карточкам. */
  positionId?: string;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
    <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
    <Text strong style={{ fontSize: 13, textAlign: 'right' }}>{children}</Text>
  </div>
);

/** Портретный телефонный список элементов позиции (вместо широкой таблицы). */
const ItemsMobileCards: React.FC<ItemsMobileCardsProps> = ({
  items,
  totalSum,
  loading = false,
  onItemClick,
  positionId,
}) => {
  // Индекс id → элемент: убирает O(n²) (items.find на каждую карточку).
  const itemById = useMemo(() => {
    const map = new Map<string, BoqItemFull>();
    for (const it of items) map.set(it.id, it);
    return map;
  }, [items]);

  // Инкрементальный рендер: на крупной позиции не строим все карточки разом.
  const { visible, sentinelRef, hasMore } = useIncrementalRender(items, 40, positionId);

  if (loading && items.length === 0) {
    return <Skeleton active paragraph={{ rows: 6 }} title={false} />;
  }

  if (items.length === 0) {
    return <Empty description="Нет элементов" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {visible.map((item) => {
        const { bgColor, textColor } = getBoqTypeTagStyle(item.boq_item_type);
        const isMat = isMaterialType(item.boq_item_type);
        const parentWork = item.parent_work_item_id
          ? itemById.get(item.parent_work_item_id)
          : null;
        const symbol = currencySymbols[item.currency_type || 'RUB'];
        const total = item.total_amount || 0;

        return (
          <Card
            key={item.id}
            size="small"
            styles={{ body: { padding: 12 } }}
            role={onItemClick ? 'button' : undefined}
            tabIndex={onItemClick ? 0 : undefined}
            onClick={onItemClick ? () => onItemClick(item) : undefined}
            onKeyDown={
              onItemClick
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onItemClick(item);
                    }
                  }
                : undefined
            }
            style={
              onItemClick ? { cursor: 'pointer', touchAction: 'manipulation' } : undefined
            }
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <Tag style={{ backgroundColor: bgColor, color: textColor, border: 'none', margin: 0 }}>
                {item.boq_item_type}
              </Tag>
              {isMat && item.material_type && (
                <Tag
                  style={{
                    backgroundColor: item.material_type === 'основн.' ? 'rgba(255, 152, 0, 0.12)' : 'rgba(21, 101, 192, 0.12)',
                    color: item.material_type === 'основн.' ? '#fb8c00' : '#1976d2',
                    border: 'none',
                    margin: 0,
                    fontSize: 11,
                  }}
                >
                  {item.material_type}
                </Tag>
              )}
            </div>

            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ wordBreak: 'break-word' }}>{item.work_name || item.material_name}</Text>
                {isMat && parentWork && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                    <LinkOutlined style={{ marginRight: 4 }} />
                    {parentWork.work_name}
                  </div>
                )}
              </div>
              {onItemClick && (
                <RightOutlined style={{ fontSize: 12, color: '#bbb', marginTop: 4, flex: '0 0 auto' }} />
              )}
            </div>

            <Field label="Кол-во">
              {item.quantity?.toFixed(5) || '-'} {item.unit_code || ''}
            </Field>
            <Field label="Цена за ед.">
              {item.unit_rate ? `${formatRu(item.unit_rate)} ${symbol}` : '-'}
            </Field>
            <Field label="Итого">
              <span style={{ color: '#10b981' }}>{total > 0 ? formatRu(total) : '-'}</span>
            </Field>
          </Card>
        );
      })}

      {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}

      <div style={{ textAlign: 'right', fontSize: 16, fontWeight: 'bold', padding: '4px 8px' }}>
        Итого: <span style={{ color: '#10b981' }}>{totalSum == null ? '—' : formatRu(Math.round(totalSum))}</span>
      </div>
    </Space>
  );
};

export default ItemsMobileCards;
