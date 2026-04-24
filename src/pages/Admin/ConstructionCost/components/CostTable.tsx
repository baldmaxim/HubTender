import React from 'react';
import { Table, Button, Space, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, FolderOutlined, FileOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { TreeNode } from '../hooks/useConstructionCost.tsx';
import { useTheme } from '../../../../contexts/ThemeContext';

interface CostTableProps {
  data: TreeNode[];
  loading: boolean;
  expandedKeys: string[];
  unitColors: Record<string, string>;
  onExpandedKeysChange: (keys: string[]) => void;
  onEdit: (record: TreeNode) => void;
  onDelete: (record: TreeNode) => void;
  onAddDetail: (record: TreeNode) => void;
  onAddLocation: (record: TreeNode) => void;
}

export const CostTable: React.FC<CostTableProps> = ({
  data,
  loading,
  expandedKeys,
  unitColors,
  onExpandedKeysChange,
  onEdit,
  onDelete,
  onAddDetail,
  onAddLocation,
}) => {
  const { theme } = useTheme();

  const columns: ColumnsType<TreeNode> = [
    {
      title: 'Структура',
      dataIndex: 'structure',
      key: 'structure',
      align: 'left',
      width: '60%',
      render: (text: string, record: TreeNode) => {
        let icon;
        let fontWeight = 400;

        if (record.type === 'category') {
          icon = <FolderOutlined style={{ color: '#1890ff' }} />;
          fontWeight = 500;
        } else if (text.startsWith('📍')) {
          icon = null;
          fontWeight = 300;
        } else {
          icon = <FileOutlined style={{ color: '#52c41a' }} />;
          fontWeight = 400;
        }

        return (
          <Space>
            {icon}
            <span style={{ fontWeight }}>
              {text}
            </span>
          </Space>
        );
      },
    },
    {
      title: 'Тип элемента',
      key: 'type',
      align: 'center',
      width: '10%',
      render: (record: TreeNode) => {
        if (record.type === 'category') {
          return <Tag color="blue">Категория</Tag>;
        } else if (record.structure?.startsWith('📍')) {
          return <Tag color="cyan">Локализация</Tag>;
        } else {
          return <Tag color="green">Детализация</Tag>;
        }
      },
    },
    {
      title: 'Единица измерения',
      dataIndex: 'unit',
      key: 'unit',
      align: 'center',
      width: '10%',
      render: (unit: string) => (
        <Tag color={unitColors[unit] || 'default'}>{unit}</Tag>
      ),
    },
    {
      title: 'Описание',
      dataIndex: 'description',
      key: 'description',
      align: 'center',
      width: '8%',
    },
    {
      title: 'Действия',
      key: 'action',
      align: 'center',
      width: '10%',
      render: (_: unknown, record: TreeNode) => (
        <Space size="small">
          {record.type === 'category' && (
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={() => onAddDetail(record)}
              title="Добавить детализацию"
            />
          )}
          {record.type === 'detail' && !record.structure?.startsWith('📍') && (
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={() => onAddLocation(record)}
              title="Добавить локализацию"
            />
          )}
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => onEdit(record)}
            title="Редактировать"
          />
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onDelete(record)}
            title="Удалить"
          />
        </Space>
      ),
    },
  ];

  const tableStyles = `
    .construction-cost-table .ant-table-row-expand-icon {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 18px !important;
      height: 18px !important;
      margin: 0 4px 0 0 !important;
      border: 1px solid ${theme === 'dark' ? '#434343' : '#d9d9d9'} !important;
      border-radius: 4px !important;
      background: ${theme === 'dark' ? '#1f1f1f' : '#fff'} !important;
      cursor: pointer !important;
      transition: all 0.2s !important;
    }

    .construction-cost-table .ant-table-row-expand-icon:hover {
      border-color: #1890ff !important;
      background: ${theme === 'dark' ? 'rgba(24, 144, 255, 0.15)' : '#f0f5ff'} !important;
    }

    .construction-cost-table .ant-table-row-expand-icon::before,
    .construction-cost-table .ant-table-row-expand-icon::after {
      content: '' !important;
      position: absolute !important;
      background: ${theme === 'dark' ? '#999' : '#666'} !important;
      transition: all 0.2s !important;
    }

    .construction-cost-table .ant-table-row-expand-icon::before {
      width: 10px !important;
      height: 2px !important;
    }

    .construction-cost-table .ant-table-row-expand-icon.ant-table-row-expand-icon-collapsed::after {
      width: 2px !important;
      height: 10px !important;
    }

    .construction-cost-table .ant-table-row-expand-icon.ant-table-row-expand-icon-expanded::after {
      display: none !important;
    }

    .construction-cost-table .ant-table-row-expand-icon:hover::before,
    .construction-cost-table .ant-table-row-expand-icon:hover::after {
      background: #1890ff !important;
    }

    .construction-cost-table .ant-table-row-expand-icon svg {
      display: none !important;
    }

    .construction-cost-table .ant-table-row-expand-icon.ant-table-row-expand-icon-spaced {
      visibility: hidden !important;
    }

    .construction-cost-table .ant-table-tbody > tr > td {
      padding: 6px 8px !important;
    }

    .construction-cost-table .ant-table-thead > tr > th {
      padding: 8px 8px !important;
    }
  `;

  return (
    <>
      <style>{tableStyles}</style>
      <Table
        className="construction-cost-table"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={false}
        size="small"
        scroll={{ y: 'calc(100vh - 300px)' }}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: (keys) => onExpandedKeysChange(keys as string[]),
        }}
        rowKey="key"
      />
    </>
  );
};
