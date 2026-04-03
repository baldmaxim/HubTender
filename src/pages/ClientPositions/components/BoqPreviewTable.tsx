import React, { useMemo } from 'react';
import { Table, Tag, Typography } from 'antd';
import type { ParsedBoqItem, PositionUpdateData, ClientPosition } from '../utils/massBoqImportUtils';

const { Text } = Typography;

interface BoqPreviewTableProps {
  parsedData: ParsedBoqItem[];
  positionUpdates: Map<string, PositionUpdateData>;
  clientPositionsMap: Map<string, ClientPosition>;
  existingItemsByPosition: Map<string, any[]>;
}

interface PreviewRow {
  key: string;
  isGroupHeader: boolean;
  positionLabel?: string;
  name?: string;
  itemType?: string;
  quantity?: number | null;
  amount?: number | null;
  status?: 'existing' | 'new';
}

const TYPE_TAG_COLORS: Record<string, string> = {
  'раб': 'orange', 'суб-раб': 'purple', 'раб-комп.': 'volcano',
  'мат': 'blue', 'суб-мат': 'green', 'мат-комп.': 'cyan',
};

// Те же цвета что в Excel-экспорте
const TYPE_ROW_COLORS: Record<string, string> = {
  'раб': '#FFE6CC',
  'суб-раб': '#E6D9F2',
  'раб-комп.': '#FFDDDD',
  'мат': '#D9EAFF',
  'суб-мат': '#E8F5E0',
  'мат-комп.': '#CCF2EF',
};

export const BoqPreviewTable: React.FC<BoqPreviewTableProps> = ({
  parsedData,
  positionUpdates,
  clientPositionsMap,
  existingItemsByPosition,
}) => {
  const rows = useMemo<PreviewRow[]>(() => {
    const result: PreviewRow[] = [];

    positionUpdates.forEach((_, posNum) => {
      const position = clientPositionsMap.get(posNum);
      if (!position) return;

      const existing = existingItemsByPosition.get(position.id) || [];
      const incoming = parsedData.filter(item => item.matchedPositionId === position.id);

      if (existing.length === 0 && incoming.length === 0) return;

      result.push({
        key: `g-${posNum}`,
        isGroupHeader: true,
        positionLabel: `${posNum}  ${position.work_name}`,
      });

      existing.forEach(item => {
        const name = (item.work_names?.name || item.material_names?.name || '—');
        result.push({
          key: `ex-${item.id}`,
          isGroupHeader: false,
          name,
          itemType: item.boq_item_type,
          quantity: item.quantity,
          amount: item.total_amount,
          status: 'existing',
        });
      });

      incoming.forEach((item, idx) => {
        const qty = item.quantity ?? item.base_quantity ?? null;
        const amount = (item.unit_rate && qty) ? Math.round(item.unit_rate * qty * 100) / 100 : null;
        result.push({
          key: `new-${posNum}-${idx}`,
          isGroupHeader: false,
          name: item.nameText,
          itemType: item.boq_item_type,
          quantity: qty,
          amount,
          status: 'new',
        });
      });
    });

    return result;
  }, [parsedData, positionUpdates, clientPositionsMap, existingItemsByPosition]);

  const columns = [
    {
      title: 'Наименование',
      key: 'name',
      ellipsis: true,
      render: (_: any, row: PreviewRow) => {
        if (row.isGroupHeader) {
          return {
            children: <Text strong style={{ fontSize: 12 }}>{row.positionLabel}</Text>,
            props: { colSpan: 5 },
          };
        }
        return { children: <Text style={{ fontSize: 12 }}>{row.name}</Text>, props: { colSpan: 1 } };
      },
    },
    {
      title: 'Тип',
      key: 'type',
      width: 90,
      render: (_: any, row: PreviewRow) => {
        if (row.isGroupHeader) return { children: null, props: { colSpan: 0 } };
        return <Tag color={TYPE_TAG_COLORS[row.itemType || ''] || 'default'} style={{ fontSize: 11 }}>{row.itemType}</Tag>;
      },
    },
    {
      title: 'Кол-во',
      key: 'qty',
      width: 80,
      align: 'right' as const,
      render: (_: any, row: PreviewRow) => {
        if (row.isGroupHeader) return { children: null, props: { colSpan: 0 } };
        return <Text style={{ fontSize: 12 }}>{row.quantity != null ? row.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) : '—'}</Text>;
      },
    },
    {
      title: 'Сумма',
      key: 'amount',
      width: 110,
      align: 'right' as const,
      render: (_: any, row: PreviewRow) => {
        if (row.isGroupHeader) return { children: null, props: { colSpan: 0 } };
        if (row.amount == null) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        const formatted = row.amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return <Text style={{ fontSize: 12 }}>{formatted}{row.status === 'new' ? '*' : ''}</Text>;
      },
    },
    {
      title: 'Статус',
      key: 'status',
      width: 110,
      align: 'center' as const,
      render: (_: any, row: PreviewRow) => {
        if (row.isGroupHeader) return { children: null, props: { colSpan: 0 } };
        return row.status === 'existing'
          ? <Tag style={{ fontSize: 11 }}>Существующий</Tag>
          : <Tag color="green" style={{ fontSize: 11 }}>Новый</Tag>;
      },
    },
  ];

  if (rows.length === 0) return null;

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
        * Сумма для новых строк ориентировочная (без учёта курса валют)
      </Text>
      <Table
        dataSource={rows}
        columns={columns}
        size="small"
        pagination={{ defaultPageSize: 50, showSizeChanger: false, simple: true }}
        onRow={(row: PreviewRow) => ({
          style: row.isGroupHeader
            ? { background: '#f0f0f0', fontWeight: 600 }
            : { background: TYPE_ROW_COLORS[row.itemType || ''] || undefined },
        })}
        scroll={{ x: 500 }}
        style={{ fontSize: 12 }}
      />
    </div>
  );
};
