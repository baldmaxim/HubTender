import React from 'react';
import { Table, Tag, Progress, Space, Button, Typography, Tooltip } from 'antd';
import {
  EditOutlined,
  PlusOutlined,
  FileTextOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import type { ProjectFull } from '../../../lib/supabase/types';

const { Text } = Typography;

interface ProjectsTableProps {
  data: ProjectFull[];
  loading: boolean;
  onEdit: (record: ProjectFull) => void;
  onAddCompletion: (record: ProjectFull) => void;
  onViewAgreements: (record: ProjectFull) => void;
  onDelete: (record: ProjectFull) => void;
}

const formatMoney = (value: number): string => {
  if (value >= 1_000_000_000) {
    const billions = value / 1_000_000_000;
    return `${billions.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} млрд ₽`;
  }
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} млн ₽`;
  }
  if (value >= 1_000) {
    return `${value.toLocaleString('ru-RU')} ₽`;
  }
  return `${value.toLocaleString('ru-RU')} ₽`;
};

export const ProjectsTable: React.FC<ProjectsTableProps> = ({
  data,
  loading,
  onEdit,
  onAddCompletion,
  onViewAgreements,
  onDelete,
}) => {
  const columns: ColumnsType<ProjectFull> = [
    {
      title: 'Наименование',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      fixed: 'left',
      render: (name: string, record) => (
        <div>
          <Text strong style={{ display: 'block' }}>
            {name}
          </Text>
          {record.tender_number && (
            <Tag color="green" style={{ fontSize: 10, marginTop: 4 }}>
              Тендер: {record.tender_number}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: 'Заказчик',
      dataIndex: 'client_name',
      key: 'client_name',
      width: 160,
      ellipsis: true,
    },
    {
      title: 'Дата договора',
      dataIndex: 'contract_date',
      key: 'contract_date',
      width: 120,
      render: (date: string | null) =>
        date ? dayjs(date).format('DD.MM.YYYY') : '—',
    },
    {
      title: 'Стоимость договора',
      dataIndex: 'contract_cost',
      key: 'contract_cost',
      width: 150,
      align: 'right',
      render: (val: number) => (
        <Tooltip title={`${val.toLocaleString('ru-RU')} ₽`}>{formatMoney(val)}</Tooltip>
      ),
    },
    {
      title: 'Доп. соглашения',
      dataIndex: 'additional_agreements_sum',
      key: 'additional_agreements_sum',
      width: 140,
      align: 'right',
      render: (val: number, record) => (
        <Button
          type="link"
          onClick={() => onViewAgreements(record)}
          style={{ padding: 0 }}
        >
          {val > 0 ? (
            <Text type="success">+{formatMoney(val)}</Text>
          ) : (
            <Text type="secondary">—</Text>
          )}
        </Button>
      ),
    },
    {
      title: 'Итого договор',
      dataIndex: 'final_contract_cost',
      key: 'final_contract_cost',
      width: 150,
      align: 'right',
      render: (val: number) => (
        <Tooltip title={`${val.toLocaleString('ru-RU')} ₽`}>
          <Text strong style={{ color: '#1890ff' }}>
            {formatMoney(val)}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Площадь',
      dataIndex: 'area',
      key: 'area',
      width: 100,
      align: 'right',
      render: (val: number | null) =>
        val ? `${val.toLocaleString('ru-RU')} м²` : '—',
    },
    {
      title: 'Срок окончания',
      dataIndex: 'construction_end_date',
      key: 'construction_end_date',
      width: 120,
      render: (date: string | null) => {
        if (!date) return '—';
        const d = dayjs(date);
        const isPast = d.isBefore(dayjs(), 'day');
        const isNear = d.diff(dayjs(), 'day') <= 30;
        return (
          <Tag color={isPast ? 'red' : isNear ? 'orange' : 'default'}>
            {d.format('DD.MM.YYYY')}
          </Tag>
        );
      },
    },
    {
      title: 'Выполнение',
      key: 'completion',
      width: 200,
      render: (_, record) => {
        const percent = Math.min(Math.round(record.completion_percentage ?? 0), 100);
        return (
          <div>
            <Progress
              percent={percent}
              size="small"
              status={percent >= 100 ? 'success' : 'active'}
              strokeColor={percent >= 100 ? '#52c41a' : '#1890ff'}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {formatMoney(record.total_completion ?? 0)}
            </Text>
          </div>
        );
      },
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Добавить выполнение">
            <Button
              icon={<PlusOutlined />}
              size="small"
              type="primary"
              onClick={() => onAddCompletion(record)}
            />
          </Tooltip>
          <Tooltip title="Доп. соглашения">
            <Button
              icon={<FileTextOutlined />}
              size="small"
              onClick={() => onViewAgreements(record)}
            />
          </Tooltip>
          <Tooltip title="Редактировать">
            <Button
              icon={<EditOutlined />}
              size="small"
              onClick={() => onEdit(record)}
            />
          </Tooltip>
          <Tooltip title="Удалить">
            <Button
              icon={<DeleteOutlined />}
              size="small"
              danger
              onClick={() => onDelete(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={data}
      rowKey="id"
      loading={loading}
      scroll={{ x: 1520 }}
      pagination={{
        pageSize: 20,
        showSizeChanger: true,
        showTotal: (total) => `Всего: ${total}`,
      }}
      size="middle"
    />
  );
};
