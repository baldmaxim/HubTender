import React from 'react';
import { Table, Button, Space, Typography } from 'antd';
import { EditOutlined, UpOutlined, DownOutlined, InboxOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { TenderRegistryWithRelations, TenderRegistry } from '../../../lib/supabase';

const { Text } = Typography;

interface TenderTableProps {
  dataSource: TenderRegistryWithRelations[];
  loading: boolean;
  isDirector: boolean;
  isArchiveTab?: boolean;
  onRowClick: (record: TenderRegistryWithRelations) => void;
  onEditClick: (record: TenderRegistryWithRelations) => void;
  onMoveUp: (tender: TenderRegistry) => void;
  onMoveDown: (tender: TenderRegistry) => void;
  onArchive: (tender: TenderRegistry) => void;
}

// Функция для получения цвета статуса
const getStatusColor = (statusName: string | undefined): string => {
  if (statusName === 'В работе') return '#10b981'; // Зелёный
  if (statusName === 'Ожидаем тендерный пакет') return '#eab308'; // Жёлтый
  if (statusName === 'Проиграли') return '#ef4444'; // Красный
  if (statusName === 'Выиграли') return '#0ea5e9'; // Голубой
  return '#d1d5db'; // Серый по умолчанию
};

export const TenderTable: React.FC<TenderTableProps> = ({
  dataSource,
  loading,
  isDirector,
  isArchiveTab = false,
  onRowClick,
  onEditClick,
  onMoveUp,
  onMoveDown,
  onArchive,
}) => {
  const columns = [
    {
      title: '№',
      key: 'index',
      width: 80,
      align: 'center' as const,
      render: (_: unknown, record: TenderRegistryWithRelations, index: number) => {
        const statusName = (record.status as { name?: string } | null | undefined)?.name;
        const color = getStatusColor(statusName);

        return (
          <Space size={4}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: color,
                display: 'inline-block',
              }}
            />
            <Text>{index + 1}</Text>
          </Space>
        );
      },
    },
    {
      title: 'Наименование',
      dataIndex: 'title',
      key: 'title',
      width: 350,
      sorter: (a: TenderRegistryWithRelations, b: TenderRegistryWithRelations) =>
        a.title.localeCompare(b.title),
    },
    {
      title: 'Заказчик',
      dataIndex: 'client_name',
      key: 'client_name',
      width: 280,
      align: 'center' as const,
      sorter: (a: TenderRegistryWithRelations, b: TenderRegistryWithRelations) =>
        a.client_name.localeCompare(b.client_name),
    },
    {
      title: 'Площадь, м²',
      dataIndex: 'area',
      key: 'area',
      width: 120,
      align: 'center' as const,
      render: (val: number | null) => {
        if (!val) return '-';
        if (val >= 10000) {
          return val.toLocaleString('ru-RU', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        }
        return val.toFixed(2);
      },
      sorter: (a: TenderRegistryWithRelations, b: TenderRegistryWithRelations) =>
        (a.area || 0) - (b.area || 0),
    },
    {
      title: 'Дата выхода на площадку',
      dataIndex: 'construction_start_date',
      key: 'construction_start_date',
      width: 180,
      align: 'center' as const,
      render: (val: string | null) =>
        val ? dayjs(val).format('DD.MM.YYYY') : <Text type="secondary">-</Text>,
      sorter: (a: TenderRegistryWithRelations, b: TenderRegistryWithRelations) =>
        (a.construction_start_date || '').localeCompare(b.construction_start_date || ''),
    },
    ...(!isDirector
      ? [
          {
            title: 'Действия',
            key: 'actions',
            width: 150,
            align: 'center' as const,
            render: (_: unknown, record: TenderRegistryWithRelations, index: number) => (
              <Space size="small">
                {!isArchiveTab && (
                  <>
                    <Button
                      size="small"
                      icon={<UpOutlined />}
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveUp(record as TenderRegistry);
                      }}
                      title="Переместить вверх"
                    />
                    <Button
                      size="small"
                      icon={<DownOutlined />}
                      disabled={index === dataSource.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveDown(record as TenderRegistry);
                      }}
                      title="Переместить вниз"
                    />
                    <Button
                      size="small"
                      icon={<InboxOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onArchive(record as TenderRegistry);
                      }}
                      title="Архивировать"
                    />
                  </>
                )}
                <Button
                  type="primary"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditClick(record);
                  }}
                  title="Редактировать"
                />
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <Table
      dataSource={dataSource}
      columns={columns}
      rowKey="id"
      loading={loading}
      pagination={{
        defaultPageSize: 25,
        showSizeChanger: true,
        pageSizeOptions: ['10', '25', '50', '100'],
        showTotal: (total) => `Всего: ${total}`,
      }}
      scroll={{ x: 1160, y: 'calc(100vh - 300px)' }}
      size="small"
      onRow={(record) => ({
        onClick: () => onRowClick(record),
        style: { cursor: 'pointer' },
      })}
    />
  );
};
