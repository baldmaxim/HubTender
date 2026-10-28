import { useMemo, type CSSProperties, type FC } from 'react';
import { Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BASIS_COLORS,
  BASIS_LABELS,
  LIST_ROW_HEIGHT,
  LIST_ROW_HEIGHT_PHONE,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../constants';
import type { IReviewRow } from '../types';
import { decisionText, positionLabel } from '../utils/format';
import { resizableHeaderProps } from '../utils/headerCell';
import { isStaleApproval } from '../utils/reviewPolicy';
import { useElementSize } from '../hooks/useElementSize';
import { useColumnWidths } from '../hooks/useColumnWidths';
import { ResizableHeaderCell } from './ResizableHeaderCell';
import styles from '../AutopriceReview.module.css';

interface IReviewTableProps {
  rows: IReviewRow[];
  selectedId: string | null;
  isPhone: boolean;
  onSelect: (positionId: string) => void;
}

const HEADER_HEIGHT = 40;
const MIN_NAME_WIDTH = 200;
const COLUMNS_STORAGE_KEY = 'autoprice-review:cols:v1';
const DEFAULT_WIDTHS = { num: 72, section: 170, items: 80, zero: 100, badges: 280, decision: 220, status: 140 };
const TABLE_COMPONENTS = { header: { cell: ResizableHeaderCell } };

const StatusTag: FC<{ row: IReviewRow }> = ({ row }) =>
  isStaleApproval(row) ? (
    <Tag color="red">Снято</Tag>
  ) : (
    <Tag color={STATUS_COLORS[row.status]}>{STATUS_LABELS[row.status]}</Tag>
  );

const Badges: FC<{ row: IReviewRow }> = ({ row }) => (
  <span className={styles.badges}>
    {row.basis && <Tag color={BASIS_COLORS[row.basis]}>{BASIS_LABELS[row.basis]}</Tag>}
    {row.questions.length > 0 && <Tag color="purple">вопросов {row.questions.length}</Tag>}
    {row.findings.length > 0 && <Tag color="gold">находок {row.findings.length}</Tag>}
  </span>
);

export const ReviewTable: FC<IReviewTableProps> = ({ rows, selectedId, isPhone, onSelect }) => {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const { widths, setWidth } = useColumnWidths(COLUMNS_STORAGE_KEY, DEFAULT_WIDTHS);
  const rowHeight = isPhone ? LIST_ROW_HEIGHT_PHONE : LIST_ROW_HEIGHT;

  const { columns, scrollX } = useMemo(() => {
    const container = Math.max(size.width, 320);
    const statusRender = (_: unknown, r: IReviewRow) => <StatusTag row={r} />;
    if (isPhone) {
      const nameWidth = Math.max(container - 56 - 110, 140);
      return {
        scrollX: 56 + nameWidth + 110,
        columns: [
          { title: '№', key: 'num', width: 56, render: (_: unknown, r) => positionLabel(r) },
          {
            title: 'Наименование',
            key: 'name',
            width: nameWidth,
            render: (_: unknown, r) => (
              <div className={styles.cellStack}>
                <span className={styles.ellipsis}>{r.work_name}</span>
                <Badges row={r} />
              </div>
            ),
          },
          { title: 'Статус', key: 'status', width: 110, render: statusRender },
        ] as ColumnsType<IReviewRow>,
      };
    }
    const resizable = (key: keyof typeof DEFAULT_WIDTHS) => ({
      width: widths[key],
      onHeaderCell: () => resizableHeaderProps(widths[key], (w) => setWidth(key, w)),
    });
    const fixed = Object.values(widths).reduce((sum, w) => sum + w, 0);
    // Наименование забирает остаток контейнера; если не хватает — таблица скроллится по горизонтали.
    const nameWidth = Math.max(container - fixed, MIN_NAME_WIDTH);
    return {
      scrollX: fixed + nameWidth,
      columns: [
        {
          title: '№',
          key: 'num',
          ...resizable('num'),
          render: (_: unknown, r) => <span className={styles.ellipsis}>{positionLabel(r)}</span>,
        },
        {
          title: 'Наименование',
          key: 'name',
          width: nameWidth,
          render: (_: unknown, r) => <span className={styles.ellipsis}>{r.work_name}</span>,
        },
        {
          title: 'Раздел',
          key: 'section',
          ...resizable('section'),
          render: (_: unknown, r) => <span className={styles.ellipsis}>{r.section ?? '—'}</span>,
        },
        { title: 'Строк', key: 'items', ...resizable('items'), align: 'right', render: (_: unknown, r) => r.items_count },
        {
          title: 'Без цены',
          key: 'zero',
          ...resizable('zero'),
          align: 'right',
          render: (_: unknown, r) =>
            r.zero_price_count > 0 ? <span className={styles.danger}>{r.zero_price_count}</span> : 0,
        },
        { title: 'Метки', key: 'badges', ...resizable('badges'), render: (_: unknown, r) => <Badges row={r} /> },
        {
          title: 'Решение',
          key: 'decision',
          ...resizable('decision'),
          render: (_: unknown, r) => {
            const text = decisionText(r, true);
            return text ? (
              <Tooltip title={text}>
                <span className={styles.ellipsis}>{decisionText(r)}</span>
              </Tooltip>
            ) : (
              '—'
            );
          },
        },
        { title: 'Статус', key: 'status', ...resizable('status'), render: statusRender },
      ] as ColumnsType<IReviewRow>,
    };
  }, [isPhone, size.width, widths, setWidth]);

  return (
    <div ref={ref} className={styles.tableWrap} style={{ '--apr-row-h': `${rowHeight}px` } as CSSProperties}>
      {size.height > 0 && (
        <Table<IReviewRow>
          className={`${styles.table} ${styles.headEllipsis}`}
          components={TABLE_COMPONENTS}
          size="small"
          rowKey="client_position_id"
          columns={columns}
          dataSource={rows}
          pagination={false}
          virtual
          scroll={{ x: scrollX, y: Math.max(size.height - HEADER_HEIGHT, 160) }}
          rowClassName={(r) => (r.client_position_id === selectedId ? styles.rowSelected : styles.row)}
          onRow={(r) => ({ onClick: () => onSelect(r.client_position_id) })}
          locale={{ emptyText: 'Нет позиций по выбранным фильтрам' }}
        />
      )}
    </div>
  );
};
