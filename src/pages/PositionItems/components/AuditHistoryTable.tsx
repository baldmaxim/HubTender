import React, { useMemo } from 'react';
import { Table, Tag, Button, Modal } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAuditHistory } from '../hooks/useAuditHistory';
import { useAuditRollback } from '../hooks/useAuditRollback';
import AuditDiffCell from './AuditDiffCell';
import type { BoqItemAudit, AuditFilters } from '../../../types/audit';
import {
  formatDateTime,
  getOperationColor,
  getOperationText,
  getUserDisplayName,
  canRollback,
} from '../utils/auditHelpers';

interface AuditHistoryTableProps {
  positionId: string | undefined;
  filters: AuditFilters;
}

/**
 * Таблица истории изменений BOQ items
 */
const AuditHistoryTable: React.FC<AuditHistoryTableProps> = ({ positionId, filters }) => {
  const { auditRecords, loading } = useAuditHistory(positionId, filters);
  const { rollback, rolling } = useAuditRollback();

  const handleRollback = (record: BoqItemAudit) => {
    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    Modal.confirm({
      title: 'Восстановить эту версию?',
      content: `Изменения от ${formatDateTime(record.changed_at)} будут отменены. Элемент вернется к предыдущему состоянию.`,
      okText: 'Восстановить',
      cancelText: 'Отмена',
      onOk: () => rollback(record),
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
    });
  };

  const columns: ColumnsType<BoqItemAudit> = useMemo(
    () => [
      {
        title: 'Дата и время',
        dataIndex: 'changed_at',
        width: 180,
        render: (val) => formatDateTime(val),
      },
      {
        title: 'Наименование',
        dataIndex: 'item_name',
        width: 300,
        render: (val) => (
          <div style={{ wordBreak: 'break-word', whiteSpace: 'normal' }}>
            {val || '-'}
          </div>
        ),
      },
      {
        title: 'Пользователь',
        dataIndex: 'changed_by',
        width: 200,
        render: (_, record) => getUserDisplayName(record),
      },
      {
        title: 'Операция',
        dataIndex: 'operation_type',
        width: 120,
        align: 'center',
        render: (op) => <Tag color={getOperationColor(op)}>{getOperationText(op)}</Tag>,
      },
      {
        title: 'Изменённые поля',
        dataIndex: 'changed_fields',
        render: (_, record) => <AuditDiffCell record={record} />,
      },
      {
        title: 'Действия',
        width: 140,
        align: 'center',
        render: (_, record) =>
          canRollback(record) ? (
            <Button
              size="small"
              icon={<HistoryOutlined />}
              onClick={() => handleRollback(record)}
              loading={rolling}
            >
              Восстановить
            </Button>
          ) : null,
      },
    ],
    // handleRollback is a stable prop function; intentionally excluded to avoid column re-creation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rolling]
  );

  return (
    <Table
      columns={columns}
      dataSource={auditRecords}
      loading={loading}
      rowKey="id"
      pagination={{
        pageSize: 20,
        showTotal: (total) => `Всего: ${total}`,
      }}
      scroll={{ x: 1200 }}
    />
  );
};

export default AuditHistoryTable;
