import React from 'react';
import { Card, Button, Space, Typography, Table, Input, App } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, ArrowUpOutlined, ArrowDownOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { MarkupParameter } from '../../../../lib/supabase';

const { Title, Text } = Typography;

interface BasePercentagesTabProps {
  markupParameters: MarkupParameter[];
  editingParameterId: string | null;
  editingParameterLabel: string;
  onAddParameter: () => void;
  onDeleteParameter: (id: string) => void;
  onReorderParameter: (id: string, direction: 'up' | 'down') => void;
  onStartEditingParameter: (id: string, label: string) => void;
  onSaveEditingParameter: () => void;
  onCancelEditingParameter: () => void;
  onEditingParameterLabelChange: (value: string) => void;
}

export const BasePercentagesTab: React.FC<BasePercentagesTabProps> = ({
  markupParameters,
  editingParameterId,
  editingParameterLabel,
  onAddParameter,
  onDeleteParameter,
  onReorderParameter,
  onStartEditingParameter,
  onSaveEditingParameter,
  onCancelEditingParameter,
  onEditingParameterLabelChange,
}) => {
  const { modal } = App.useApp();

  const handleDelete = (id: string, label: string) => {
    modal.confirm({
      title: 'Удалить параметр наценки?',
      content: `Вы действительно хотите удалить параметр "${label}"?`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      onOk: () => onDeleteParameter(id),
    });
  };

  const columns = [
    {
      title: '№',
      width: 60,
      render: (_: unknown, __: unknown, index: number) => index + 1,
    },
    {
      title: 'Название параметра',
      dataIndex: 'label',
      key: 'label',
      render: (text: string, record: MarkupParameter) => {
        if (editingParameterId === record.id) {
          return (
            <Input
              value={editingParameterLabel}
              onChange={(e) => onEditingParameterLabelChange(e.target.value)}
              onPressEnter={onSaveEditingParameter}
              autoFocus
              suffix={
                <Space size={4}>
                  <Button
                    type="text"
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={onSaveEditingParameter}
                    style={{ color: '#52c41a' }}
                  />
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={onCancelEditingParameter}
                  />
                </Space>
              }
            />
          );
        }
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text>{text}</Text>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onStartEditingParameter(record.id, text)}
            />
          </div>
        );
      },
    },
    {
      title: 'Порядок',
      width: 120,
      render: (_: unknown, record: MarkupParameter, index: number) => (
        <Space>
          <Button
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={index === 0}
            onClick={() => onReorderParameter(record.id, 'up')}
          />
          <Button
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={index === markupParameters.length - 1}
            onClick={() => onReorderParameter(record.id, 'down')}
          />
        </Space>
      ),
    },
    {
      title: 'Действия',
      width: 100,
      render: (_: unknown, record: MarkupParameter) => (
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => handleDelete(record.id, record.label)}
        >
          Удалить
        </Button>
      ),
    },
  ];

  return (
    <Card
      title={
        <Space direction="vertical" size={0}>
          <Title level={4} style={{ margin: 0 }}>
            Базовые проценты наценок
          </Title>
          <Text type="secondary" style={{ fontSize: '14px' }}>
            Управление параметрами наценок для использования в схемах
          </Text>
        </Space>
      }
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={onAddParameter}>
          Добавить параметр
        </Button>
      }
    >
      <Table
        dataSource={markupParameters}
        columns={columns}
        rowKey="id"
        pagination={false}
        locale={{ emptyText: 'Нет параметров наценок' }}
      />
    </Card>
  );
};
