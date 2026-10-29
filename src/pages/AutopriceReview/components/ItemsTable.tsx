import { useMemo, type FC } from 'react';
import { Button, Popconfirm, Table, Tag, Tooltip } from 'antd';
import { DeleteOutlined, EllipsisOutlined, SwapOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { IDeletedItem, IPositionItem } from '../types';
import { formatDateTime } from '../utils/format';
import { resizableHeaderProps } from '../utils/headerCell';
import { useColumnWidths } from '../hooks/useColumnWidths';
import { useElementSize } from '../hooks/useElementSize';
import { ResizableHeaderCell } from './ResizableHeaderCell';
import { ItemTypeTag } from './ItemTypeTag';
import {
  renderConsCell,
  renderConvCell,
  renderNameCell,
  renderPriceCell,
  renderQtyCell,
  renderTypeCell,
  type IItemsEditing,
} from './itemColumns';
import { getBoqTypeTagStyle } from '../../PositionItems/components/boqColors';
import { isBoqItemType, summarizeItems, workIdSet } from '../utils/itemTypes';
import styles from '../AutopriceReview.module.css';

interface IItemsTableProps {
  items: IPositionItem[];
  deleted: IDeletedItem[];
  /** Открыть лист «Все поля строки»; без него столбца с кнопкой нет. */
  onEditItem?: (itemId: string) => void;
  /** Правка прямо в строке; без него таблица только показывает текст. */
  editing?: IItemsEditing;
  /** Действия «Заменить» и «Удалить»; показываются, когда строки доступны для правки (editing.ready && canEdit). */
  onReplaceItem?: (itemId: string) => void;
  onDeleteItem?: (itemId: string) => Promise<void>;
}

const MIN_NAME_WIDTH = 120;
const COLUMNS_STORAGE_KEY = 'autoprice-review:item-cols:v3';
const EDIT_COL_WIDTH = 44;
const ACTIONS_COL_WIDTH = 88;
const DEFAULT_WIDTHS = { type: 96, unit: 56, qty: 96, price: 104, conv: 84, cons: 84 };
const TABLE_COMPONENTS = { header: { cell: ResizableHeaderCell } };

export const ItemsTable: FC<IItemsTableProps> = ({ items, deleted, onEditItem, editing, onReplaceItem, onDeleteItem }) => {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const { widths, setWidth } = useColumnWidths(COLUMNS_STORAGE_KEY, DEFAULT_WIDTHS);

  const works = useMemo(() => workIdSet(items), [items]);
  const summary = useMemo(() => summarizeItems(items), [items]);
  const showActions = !!onReplaceItem && !!onDeleteItem && !!editing?.ready && !!editing.canEdit;

  const { columns, scrollX } = useMemo(() => {
    const resizable = (key: keyof typeof DEFAULT_WIDTHS) => ({
      width: widths[key],
      onHeaderCell: () => resizableHeaderProps(widths[key], (w) => setWidth(key, w)),
    });
    const fixed = Object.values(widths).reduce((sum, w) => sum + w, 0) + (onEditItem ? EDIT_COL_WIDTH : 0) +
      (showActions ? ACTIONS_COL_WIDTH : 0);
    // Наименование забирает остаток ширины панели и переносится по словам.
    const nameWidth = Math.max(size.width - fixed, MIN_NAME_WIDTH);
    const cols: ColumnsType<IPositionItem> = [
      {
        title: 'Тип',
        key: 'type',
        ...resizable('type'),
        render: (_: unknown, item) => renderTypeCell(item, works, editing),
      },
      {
        title: 'Наименование',
        key: 'name',
        width: nameWidth,
        render: (_: unknown, item) => renderNameCell(item, works),
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
        render: (_: unknown, item) => renderQtyCell(item, editing),
      },
      {
        title: 'Цена',
        key: 'price',
        ...resizable('price'),
        align: 'right',
        render: (_: unknown, item) => renderPriceCell(item, editing),
      },
      {
        title: 'Перев.',
        key: 'conv',
        ...resizable('conv'),
        align: 'right',
        render: (_: unknown, item) => renderConvCell(item, editing),
      },
      {
        title: 'Расх.',
        key: 'cons',
        ...resizable('cons'),
        align: 'right',
        render: (_: unknown, item) => renderConsCell(item, editing),
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
          <Tooltip title="Все поля строки">
            <Button
              className={styles.editBtn}
              type="text"
              icon={<EllipsisOutlined />}
              aria-label="Все поля строки"
              onClick={() => onEditItem(item.id)}
            />
          </Tooltip>
        ),
      });
    }
    if (showActions) {
      cols.push({
        title: '',
        key: 'actions',
        className: styles.editCell,
        width: ACTIONS_COL_WIDTH,
        align: 'center',
        render: (_: unknown, item) => {
          const linked = items.filter((i) => i.parent_work_item_id === item.id).length;
          return (
            <span className={styles.rowActions}>
              <Tooltip title="Заменить">
                <Button
                  className={styles.editBtn}
                  type="text"
                  icon={<SwapOutlined />}
                  aria-label={`Заменить: ${item.name}`}
                  onClick={() => onReplaceItem(item.id)}
                />
              </Tooltip>
              <Popconfirm
                title="Удалить строку?"
                description={linked > 0 ? `Привязанные материалы (${linked}) удалятся вместе с работой` : undefined}
                okText="Удалить"
                cancelText="Отмена"
                okButtonProps={{ danger: true }}
                onConfirm={() => onDeleteItem(item.id)}
              >
                <Tooltip title="Удалить">
                  <Button
                    className={styles.editBtn}
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`Удалить: ${item.name}`}
                  />
                </Tooltip>
              </Popconfirm>
            </span>
          );
        },
      });
    }
    return { columns: cols, scrollX: fixed + nameWidth };
  }, [widths, setWidth, size.width, works, onEditItem, editing, items, showActions, onReplaceItem, onDeleteItem]);

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
