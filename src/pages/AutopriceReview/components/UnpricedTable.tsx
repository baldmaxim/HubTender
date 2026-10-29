import { useMemo, type CSSProperties, type FC } from 'react';
import { Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DERIVED_REASON_COLORS,
  DERIVED_REASON_LABELS,
  LIST_ROW_HEIGHT,
  LIST_ROW_HEIGHT_PHONE,
  LOADER_REASON_COLORS,
  LOADER_REASON_LABELS,
} from '../constants';
import type { IUnpricedRow } from '../types';
import { formatNumber, positionLabel } from '../utils/format';
import { useElementSize } from '../hooks/useElementSize';
import styles from '../AutopriceReview.module.css';

interface IUnpricedTableProps {
  rows: IUnpricedRow[];
  isPhone: boolean;
  onOpen: (positionId: string) => void;
}

const HEADER_HEIGHT = 40;
const MIN_NAME_WIDTH = 200;
const WIDTHS = { num: 96, unit: 64, volume: 100, items: 150, reason: 340 };

const ReasonTags: FC<{ row: IUnpricedRow }> = ({ row }) => (
  <span className={styles.badges}>
    {row.loader_reason_code && (
      <Tag color={LOADER_REASON_COLORS[row.loader_reason_code]}>{LOADER_REASON_LABELS[row.loader_reason_code]}</Tag>
    )}
    <Tag color={DERIVED_REASON_COLORS[row.derived_reason]}>{DERIVED_REASON_LABELS[row.derived_reason]}</Tag>
  </span>
);

const ReasonCell: FC<{ row: IUnpricedRow }> = ({ row }) => (
  <div className={styles.cellStack}>
    <ReasonTags row={row} />
    {row.loader_reason && (
      <span className={`${styles.ellipsis} ${styles.muted}`} title={row.loader_reason}>
        {row.loader_reason}
      </span>
    )}
  </div>
);

export const UnpricedTable: FC<IUnpricedTableProps> = ({ rows, isPhone, onOpen }) => {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const rowHeight = isPhone ? LIST_ROW_HEIGHT_PHONE : LIST_ROW_HEIGHT;

  const { columns, scrollX } = useMemo(() => {
    const container = Math.max(size.width, 320);
    if (isPhone) {
      const numWidth = 56;
      const nameWidth = Math.max(container - numWidth, 240);
      return {
        scrollX: numWidth + nameWidth,
        columns: [
          { title: '№', key: 'num', width: numWidth, render: (_: unknown, r) => positionLabel(r) },
          {
            title: 'Наименование',
            key: 'name',
            width: nameWidth,
            render: (_: unknown, r) => (
              <div className={styles.cellStack}>
                <span className={styles.ellipsis}>{r.work_name}</span>
                <ReasonTags row={r} />
              </div>
            ),
          },
        ] as ColumnsType<IUnpricedRow>,
      };
    }
    const fixed = Object.values(WIDTHS).reduce((sum, w) => sum + w, 0);
    // Наименование забирает остаток контейнера; если не хватает — таблица скроллится по горизонтали.
    const nameWidth = Math.max(container - fixed, MIN_NAME_WIDTH);
    return {
      scrollX: fixed + nameWidth,
      columns: [
        {
          title: '№',
          key: 'num',
          width: WIDTHS.num,
          render: (_: unknown, r) => <span className={styles.ellipsis}>{positionLabel(r)}</span>,
        },
        {
          title: 'Наименование',
          key: 'name',
          width: nameWidth,
          render: (_: unknown, r) => (
            <div className={styles.cellStack}>
              <span className={styles.ellipsis}>{r.work_name}</span>
              {r.section_name && <span className={`${styles.ellipsis} ${styles.muted}`}>{r.section_name}</span>}
            </div>
          ),
        },
        { title: 'Ед.', key: 'unit', width: WIDTHS.unit, render: (_: unknown, r) => r.unit_code ?? '—' },
        {
          title: 'Объём',
          key: 'volume',
          width: WIDTHS.volume,
          align: 'right',
          render: (_: unknown, r) => formatNumber(r.volume, 3),
        },
        {
          title: 'Строк',
          key: 'items',
          width: WIDTHS.items,
          align: 'right',
          render: (_: unknown, r) => (
            <div className={styles.cellStack}>
              <span>{r.items_count}</span>
              {r.run_items_count > 0 && <span className={styles.muted}>из них прогона: {r.run_items_count}</span>}
            </div>
          ),
        },
        { title: 'Причина', key: 'reason', width: WIDTHS.reason, render: (_: unknown, r) => <ReasonCell row={r} /> },
      ] as ColumnsType<IUnpricedRow>,
    };
  }, [isPhone, size.width]);

  return (
    <div ref={ref} className={styles.tableWrap} style={{ '--apr-row-h': `${rowHeight}px` } as CSSProperties}>
      {size.height > 0 && (
        <Table<IUnpricedRow>
          className={`${styles.table} ${styles.headEllipsis}`}
          size="small"
          rowKey="position_id"
          columns={columns}
          dataSource={rows}
          pagination={false}
          virtual
          scroll={{ x: scrollX, y: Math.max(size.height - HEADER_HEIGHT, 160) }}
          rowClassName={styles.row}
          onRow={(r) => ({ onClick: () => onOpen(r.position_id) })}
          locale={{ emptyText: 'Нет позиций по выбранным фильтрам' }}
        />
      )}
    </div>
  );
};
