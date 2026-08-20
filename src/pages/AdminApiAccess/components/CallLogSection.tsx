import { FC } from 'react';
import { Button, Card, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import type { ApiCallLogEntry, ApiKey } from '../../../lib/api/apiAccess';
import { formatDateTime } from '../utils/format';

const { Text } = Typography;

interface ICallLogSectionProps {
  entries: ApiCallLogEntry[];
  keys: ApiKey[];
  loading: boolean;
  filterKeyId?: string;
  onlyErrors: boolean;
  onFilterKey: (id?: string) => void;
  onToggleErrors: (value: boolean) => void;
  onRefresh: () => void;
}

const statusColor = (status: number): string => {
  if (status >= 500) return 'red';
  if (status >= 400) return 'orange';
  return 'green';
};

export const CallLogSection: FC<ICallLogSectionProps> = ({
  entries, keys, loading, filterKeyId, onlyErrors, onFilterKey, onToggleErrors, onRefresh,
}) => {
  const columns: ColumnsType<ApiCallLogEntry> = [
    {
      title: 'Время',
      dataIndex: 'called_at',
      key: 'called_at',
      width: 170,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: 'Источник',
      key: 'source',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>{row.api_key_name ?? 'через браузер'}</Text>
          {row.user_name && (
            <Text type="secondary" style={{ fontSize: 12 }}>{row.user_name}</Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Запрос',
      key: 'request',
      render: (_, row) => (
        <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {row.method} {row.path}
        </Text>
      ),
    },
    {
      title: 'Ответ',
      key: 'status',
      width: 150,
      render: (_, row) => (
        <Space size={4}>
          <Tag color={statusColor(row.status)}>{row.status}</Tag>
          {row.error_code && (
            <Tooltip title={row.error_code}>
              <Tag>{row.error_code}</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Строк',
      key: 'items',
      width: 110,
      render: (_, row) => (
        <Space size={4}>
          <Text>{row.items_affected ?? '—'}</Text>
          {row.dry_run && <Tag color="blue">проба</Tag>}
        </Space>
      ),
    },
    {
      title: 'Время ответа',
      dataIndex: 'duration_ms',
      key: 'duration_ms',
      width: 120,
      render: (v: number) => `${v} мс`,
    },
  ];

  return (
    <Card
      title="Журнал вызовов"
      extra={
        <Space wrap>
          <Select
            allowClear
            placeholder="Все ключи"
            style={{ minWidth: 200 }}
            value={filterKeyId}
            onChange={onFilterKey}
            options={keys.map((k) => ({ value: k.id, label: k.name }))}
          />
          <Space size={4}>
            <Switch checked={onlyErrors} onChange={onToggleErrors} size="small" />
            <Text>только ошибки</Text>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
            Обновить
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={entries}
        loading={loading}
        size="small"
        scroll={{ x: 900 }}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        locale={{ emptyText: 'Вызовов пока не было' }}
      />
    </Card>
  );
};
