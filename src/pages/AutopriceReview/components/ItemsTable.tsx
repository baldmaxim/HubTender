import { useMemo, type FC, type ReactNode } from 'react';
import { Button, Table, Tag, Tooltip } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { CHANGED_TO_COLUMN } from '../constants';
import type { IDeletedItem, IPositionItem } from '../types';
import { formatDateTime, formatNumber } from '../utils/format';
import { resizableHeaderProps } from '../utils/headerCell';
import { useColumnWidths } from '../hooks/useColumnWidths';
import { useElementSize } from '../hooks/useElementSize';
import { ResizableHeaderCell } from './ResizableHeaderCell';
import { ItemTypeCell, ItemTypeTag } from './ItemTypeTag';
import { getBoqTypeTagStyle } from '../../PositionItems/components/boqColors';
import { isBoqItemType, isLinkedToWork, summarizeItems, workIdSet } from '../utils/itemTypes';
import styles from '../AutopriceReview.module.css';

type ColumnKind = 'type' | 'name' | 'unit_rate' | 'conversion' | 'consumption';

interface IItemsTableProps {
  items: IPositionItem[];
  deleted: IDeletedItem[];
  /** Открыть правку строки; без него столбца правки нет. */
  onEditItem?: (itemId: string) => void;
}

const changedColumns = (item: IPositionItem): Set<ColumnKind> =>
  new Set(item.changed.map((f) => CHANGED_TO_COLUMN[f]));

const machineValue = (item: IPositionItem, kind: ColumnKind): string => {
  const m = item.machine;
  if (!m) return '—';
  switch (kind) {
    case 'type':
      return m.material_type || '—';
    case 'name':
      return m.name || '—';
    case 'unit_rate':
      return formatNumber(m.unit_rate);
    case 'conversion':
      return formatNumber(m.conversion_coefficient, 4);
    case 'consumption':
      return formatNumber(m.consumption_coefficient, 4);
  }
};

/** Ячейка; если поле изменено относительно машины — подсветка и подсказка «машина: X». */
const cell = (item: IPositionItem, kind: ColumnKind, content: ReactNode) => {
  if (!changedColumns(item).has(kind)) return content;
  return (
    <Tooltip title={`машина: ${machineValue(item, kind)}`}>
      <span className={styles.changedCell}>{content}</span>
    </Tooltip>
  );
};

const MIN_NAME_WIDTH = 120;
const COLUMNS_STORAGE_KEY = 'autoprice-review:item-cols:v2';
const EDIT_COL_WIDTH = 44;
const DEFAULT_WIDTHS = { type: 78, unit: 56, qty: 84, price: 90, conv: 72, cons: 72 };
const TABLE_COMPONENTS = { header: { cell: ResizableHeaderCell } };

export const ItemsTable: FC<IItemsTableProps> = ({ items, deleted, onEditItem }) => {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const { widths, setWidth } = useColumnWidths(COLUMNS_STORAGE_KEY, DEFAULT_WIDTHS);

  const works = useMemo(() => workIdSet(items), [items]);
  const summary = useMemo(() => summarizeItems(items), [items]);

  const { columns, scrollX } = useMemo(() => {
    const resizable = (key: keyof typeof DEFAULT_WIDTHS) => ({
      width: widths[key],
      onHeaderCell: () => resizableHeaderProps(widths[key], (w) => setWidth(key, w)),
    });
    const fixed = Object.values(widths).reduce((sum, w) => sum + w, 0) + (onEditItem ? EDIT_COL_WIDTH : 0);
    // Наименование забирает остаток ширины панели и переносится по словам.
    const nameWidth = Math.max(size.width - fixed, MIN_NAME_WIDTH);
    const cols: ColumnsType<IPositionItem> = [
      {
        title: 'Тип',
        key: 'type',
        ...resizable('type'),
        render: (_: unknown, item) =>
          cell(item, 'type', <ItemTypeCell item={item} linked={isLinkedToWork(item, works)} />),
      },
      {
        title: 'Наименование',
        key: 'name',
        width: nameWidth,
        render: (_: unknown, item) => (
          <span className={`${styles.itemName} ${isLinkedToWork(item, works) ? styles.childName : ''}`}>
            {isLinkedToWork(item, works) && <span className={styles.childMark}>↳</span>}
            {cell(item, 'name', item.name)}
            {item.origin === 'manual' && <Tag color="blue">добавлено</Tag>}
          </span>
        ),
      },
      {
        title: 'Ед.',
        dataIndex: 'unit_code',
        key: 'unit',
        ...resizable('unit'),
        render: (v: string | null) => v ?? '—',
      },
      {
        title: 'Кол-во',
        key: 'qty',
        ...resizable('qty'),
        align: 'right',
        render: (_: unknown, item) => formatNumber(item.quantity, 4),
      },
      {
        title: 'Цена',
        key: 'price',
        ...resizable('price'),
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
        ...resizable('conv'),
        align: 'right',
        render: (_: unknown, item) => cell(item, 'conversion', formatNumber(item.conversion_coefficient, 4)),
      },
      {
        title: 'Расх.',
        key: 'cons',
        ...resizable('cons'),
        align: 'right',
        render: (_: unknown, item) => cell(item, 'consumption', formatNumber(item.consumption_coefficient, 4)),
      },
    ];
    if (onEditItem) {
      cols.push({
        title: '',
        key: 'edit',
        className: styles.editCell,
        width: EDIT_COL_WIDTH,
        align: 'center',
        render: (_: unknown, item) => (
          <Button
            className={styles.editBtn}
            type="text"
            icon={<EditOutlined />}
            aria-label="Изменить строку"
            onClick={() => onEditItem(item.id)}
          />
        ),
      });
    }
    return { columns: cols, scrollX: fixed + nameWidth };
  }, [widths, setWidth, size.width, works, onEditItem]);

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        Строки расчёта ({items.length})
        {summary && <span className={styles.itemsSummary}> · {summary}</span>}
      </div>
      <div ref={ref}>
        <Table<IPositionItem>
          className={styles.headEllipsis}
          components={TABLE_COMPONENTS}
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={items}
          pagination={false}
          scroll={{ x: scrollX }}
          onRow={(item) => ({
            onDoubleClick: onEditItem ? () => onEditItem(item.id) : undefined,
            style: isBoqItemType(item.boq_item_type)
              ? { backgroundColor: getBoqTypeTagStyle(item.boq_item_type).bgColor }
              : undefined,
          })}
          locale={{ emptyText: 'Строк нет' }}
        />
      </div>
      {deleted.length > 0 && (
        <div className={styles.deletedBlock}>
          <div className={styles.sectionTitle}>Удалено ({deleted.length})</div>
          <ul className={styles.plainList}>
            {deleted.map((d) => (
              <li key={d.boq_item_id}>
                <ItemTypeTag type={d.boq_item_type} />
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
};
