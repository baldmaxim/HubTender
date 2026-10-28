import { type FC } from 'react';
import { Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CHANGED_TO_COLUMN } from '../constants';
import type { IDeletedItem, IPositionItem } from '../types';
import { formatDateTime, formatNumber } from '../utils/format';
import styles from '../AutopriceReview.module.css';

type ColumnKind = 'name' | 'unit_rate' | 'conversion' | 'consumption';

interface IItemsTableProps {
  items: IPositionItem[];
  deleted: IDeletedItem[];
}

const changedColumns = (item: IPositionItem): Set<ColumnKind> =>
  new Set(item.changed.map((f) => CHANGED_TO_COLUMN[f]));

const machineValue = (item: IPositionItem, kind: ColumnKind): string => {
  const m = item.machine;
  if (!m) return '—';
  switch (kind) {
    case 'name':
      return [m.name, m.material_type].filter(Boolean).join(' · ') || '—';
    case 'unit_rate':
      return formatNumber(m.unit_rate);
    case 'conversion':
      return formatNumber(m.conversion_coefficient, 4);
    case 'consumption':
      return formatNumber(m.consumption_coefficient, 4);
  }
};

/** Ячейка; если поле изменено относительно машины — подсветка и подсказка «машина: X». */
const cell = (item: IPositionItem, kind: ColumnKind, content: string) => {
  if (!changedColumns(item).has(kind)) return content;
  return (
    <Tooltip title={`машина: ${machineValue(item, kind)}`}>
      <span className={styles.changedCell}>{content}</span>
    </Tooltip>
  );
};

const columns: ColumnsType<IPositionItem> = [
  {
    title: 'Наименование',
    key: 'name',
    width: 240,
    render: (_: unknown, item) => (
      <span className={styles.itemName}>
        {cell(item, 'name', item.name)}
        {item.origin === 'manual' && <Tag color="blue">добавлено</Tag>}
      </span>
    ),
  },
  { title: 'Ед.', dataIndex: 'unit_code', key: 'unit', width: 60, render: (v: string | null) => v ?? '—' },
  {
    title: 'Кол-во',
    key: 'qty',
    width: 90,
    align: 'right',
    render: (_: unknown, item) => formatNumber(item.quantity, 4),
  },
  {
    title: 'Цена',
    key: 'price',
    width: 100,
    align: 'right',
    render: (_: unknown, item) =>
      item.unit_rate === 0 ? (
        <span className={styles.danger}>0</span>
      ) : (
        cell(item, 'unit_rate', formatNumber(item.unit_rate))
      ),
  },
  {
    title: 'Перев.',
    key: 'conv',
    width: 80,
    align: 'right',
    render: (_: unknown, item) => cell(item, 'conversion', formatNumber(item.conversion_coefficient, 4)),
  },
  {
    title: 'Расх.',
    key: 'cons',
    width: 80,
    align: 'right',
    render: (_: unknown, item) => cell(item, 'consumption', formatNumber(item.consumption_coefficient, 4)),
  },
];

export const ItemsTable: FC<IItemsTableProps> = ({ items, deleted }) => (
  <div className={styles.section}>
    <div className={styles.sectionTitle}>Строки расчёта ({items.length})</div>
    <Table<IPositionItem>
      size="small"
      rowKey="id"
      columns={columns}
      dataSource={items}
      pagination={false}
      scroll={{ x: 650 }}
      locale={{ emptyText: 'Строк нет' }}
    />
    {deleted.length > 0 && (
      <div className={styles.deletedBlock}>
        <div className={styles.sectionTitle}>Удалено ({deleted.length})</div>
        <ul className={styles.plainList}>
          {deleted.map((d) => (
            <li key={d.boq_item_id}>
              <Tag color="red">удалено</Tag>
              {d.name}
              <span className={styles.muted}>
                {' '}
                — {formatDateTime(d.deleted_at)}
                {d.deleted_by_name ? `, ${d.deleted_by_name}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);
