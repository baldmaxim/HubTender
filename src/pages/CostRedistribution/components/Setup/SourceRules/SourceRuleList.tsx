/**
 * Список правил вычитания
 */

import React from 'react';
import { Table, Button, Tag } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { SourceRule } from '../../../utils';

interface SourceRuleListProps {
  rules: SourceRule[];
  onRemove: (index: number) => void;
}

export const SourceRuleList: React.FC<SourceRuleListProps> = ({ rules, onRemove }) => {
  const columns: ColumnsType<SourceRule & { index: number }> = [
    {
      title: '№',
      dataIndex: 'index',
      key: 'index',
      width: 60,
      render: (_, __, index) => index + 1,
    },
    {
      title: 'Затрата на строительство',
      dataIndex: 'category_name',
      key: 'category_name',
      render: (text) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: 'Процент вычета',
      dataIndex: 'percentage',
      key: 'percentage',
      width: 150,
      render: (value) => `${value}%`,
    },
    {
      title: 'Типы',
      dataIndex: 'boq_item_types',
      key: 'boq_item_types',
      width: 220,
      render: (types: string[] | undefined) => {
        if (!types || types.length === 0) {
          return <Tag>все типы</Tag>;
        }
        return types.map(t => <Tag key={t} color="geekblue">{t}</Tag>);
      },
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 100,
      render: (_, __, index) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onRemove(index)}
          size="small"
        >
          Удалить
        </Button>
      ),
    },
  ];

  const dataSource = rules.map((rule, index) => ({
    ...rule,
    index,
    key: index,
  }));

  if (rules.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: '#999' }}>
        Правила вычитания не добавлены
      </div>
    );
  }

  return (
    <Table
      columns={columns}
      dataSource={dataSource}
      pagination={false}
      size="small"
      bordered
    />
  );
};
