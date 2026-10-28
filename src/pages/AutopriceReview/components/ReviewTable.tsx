import { useMemo, type CSSProperties, type FC } from 'react';
import { Table, Tag } from 'antd';
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
import { positionLabel } from '../utils/format';
import { isStaleApproval } from '../utils/reviewPolicy';
import { useElementSize } from '../hooks/useElementSize';
import styles from '../AutopriceReview.module.css';

interface IReviewTableProps {
  rows: IReviewRow[];
  selectedId: string | null;
  isPhone: boolean;
  onSelect: (positionId: string) => void;
}

const HEADER_HEIGHT = 40;
const MIN_NAME_WIDTH = 260;

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
  const rowHeight = isPhone ? LIST_ROW_HEIGHT_PHONE : LIST_ROW_HEIGHT;

  const { columns, scrollX } = useMemo(() => {
    const num: ColumnsType<IReviewRow>[number] = {
      title: '№',
      key: 'num',
      width: isPhone ? 56 : 90,
      render: (_: unknown, r) => positionLabel(r),
    };
    const status: ColumnsType<IReviewRow>[number] = {
      title: 'Статус',
      key: 'status',
      width: isPhone ? 110 : 140,
      render: (_: unknown, r) => <StatusTag row={r} />,
    };
    const container = Math.max(size.width, 320);
    if (isPhone) {
      const nameWidth = Math.max(container - 56 - 110, 140);
      return {
        scrollX: 56 + nameWidth + 110,
        columns: [
          num,
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
          status,
        ] as ColumnsType<IReviewRow>,
      };
    }
    const fixed = 90 + 170 + 80 + 100 + 280 + 140;
    const nameWidth = Math.max(container - fixed, MIN_NAME_WIDTH);
    return {
      scrollX: fixed + nameWidth,
      columns: [
        num,
        {
          title: 'Наименование',
          key: 'name',
          width: nameWidth,
          render: (_: unknown, r) => <span className={styles.ellipsis}>{r.work_name}</span>,
        },
        {
          title: 'Раздел',
          key: 'section',
          width: 170,
          render: (_: unknown, r) => <span className={styles.ellipsis}>{r.section ?? '—'}</span>,
        },
        { title: 'Строк', key: 'items', width: 80, align: 'right', render: (_: unknown, r) => r.items_count },
        {
          title: 'Без цены',
          key: 'zero',
          width: 100,
          align: 'right',
          render: (_: unknown, r) =>
            r.zero_price_count > 0 ? <span className={styles.danger}>{r.zero_price_count}</span> : 0,
        },
        { title: 'Метки', key: 'badges', width: 280, render: (_: unknown, r) => <Badges row={r} /> },
        status,
      ] as ColumnsType<IReviewRow>,
    };
  }, [isPhone, size.width]);

  return (
    <div ref={ref} className={styles.tableWrap} style={{ '--apr-row-h': `${rowHeight}px` } as CSSProperties}>
      {size.height > 0 && (
        <Table<IReviewRow>
          className={styles.table}
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
