import React, { useState, useImperativeHandle, forwardRef } from 'react';
import { Table, Button, Space, Tooltip, Tag, Modal, Form, Input, InputNumber, Switch } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { UnitRecord } from '../hooks/useUnits.tsx';

interface UnitsTabProps {
  data: UnitRecord[];
  loading: boolean;
  unitColors: Record<string, string>;
  currentPage: number;
  pageSize: number;
  onDelete: (record: UnitRecord) => void;
  onSave: (values: { code?: string; name: string; category?: string; sort_order?: number; is_active?: boolean }, editingCode?: string) => Promise<boolean>;
  onPageChange: (page: number, newPageSize: number) => void;
}

export interface UnitsTabRef {
  openAddModal: () => void;
}

export const UnitsTab = forwardRef<UnitsTabRef, UnitsTabProps>(({
  data,
  loading,
  unitColors,
  currentPage,
  pageSize,
  onDelete,
  onSave,
  onPageChange,
}, ref) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitRecord | null>(null);
  const [form] = Form.useForm();

  useImperativeHandle(ref, () => ({
    openAddModal: () => {
      setEditingUnit(null);
      form.resetFields();
      setModalOpen(true);
    },
  }));

  const handleEditClick = (record: UnitRecord) => {
    setEditingUnit(record);
    form.setFieldsValue({
      code: record.code,
      name: record.name,
      category: record.category,
      sort_order: record.sort_order,
      is_active: record.is_active,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const success = await onSave(values, editingUnit?.code);
      if (success) {
        setModalOpen(false);
        form.resetFields();
      }
    } catch (error) {
      console.error('Validation error:', error);
    }
  };

  const columns: ColumnsType<UnitRecord> = [
    {
      title: '№',
      key: 'index',
      width: 60,
      align: 'center',
      render: (_: unknown, __: unknown, index: number) => (currentPage - 1) * pageSize + index + 1,
    },
    {
      title: 'Наименование',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Код',
      dataIndex: 'code',
      key: 'code',
      width: 100,
      align: 'center',
      render: (code: string) => (
        <Tag color={unitColors[code] || 'default'}>{code}</Tag>
      ),
    },
    {
      title: 'Категория',
      dataIndex: 'category',
      key: 'category',
      width: 150,
      align: 'center',
      render: (category: string) => (
        <Tag>{category}</Tag>
      ),
    },
    {
      title: 'Порядок',
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 100,
      align: 'center',
    },
    {
      title: 'Статус',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 120,
      align: 'center',
      render: (is_active: boolean) => (
        <Tag color={is_active ? 'green' : 'red'}>
          {is_active ? 'Активна' : 'Неактивна'}
        </Tag>
      ),
    },
    {
      title: 'Дата создания',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      align: 'center',
    },
    {
      title: 'Действия',
      key: 'action',
      width: 120,
      align: 'center',
      render: (_: unknown, record: UnitRecord) => (
        <Space size="small">
          <Tooltip title="Редактировать">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEditClick(record)}
            />
          </Tooltip>
          <Tooltip title="Удалить">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const paginationConfig = {
    current: currentPage,
    pageSize: pageSize,
    showSizeChanger: true,
    showQuickJumper: true,
    pageSizeOptions: ['10', '20', '50', '100'],
    showTotal: (total: number, range: [number, number]) =>
      `${range[0]}-${range[1]} из ${total} записей`,
    onChange: onPageChange,
  };

  return (
    <>
      <Table
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={paginationConfig}
        size="middle"
        scroll={{ y: 'calc(100vh - 340px)' }}
      />

      <Modal
        title={editingUnit ? 'Редактировать единицу измерения' : 'Добавить единицу измерения'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        okText="Сохранить"
        cancelText="Отмена"
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 20 }}
        >
          <Form.Item
            name="name"
            label="Полное наименование"
            rules={[{ required: true, message: 'Введите наименование' }]}
          >
            <Input placeholder="Например: квадратный метр" />
          </Form.Item>

          <Form.Item
            name="code"
            label="Код единицы измерения"
            rules={[
              { required: true, message: 'Введите код единицы измерения' },
              { max: 10, message: 'Максимум 10 символов' },
            ]}
          >
            <Input
              placeholder="Например: м2, шт, т"
              disabled={!!editingUnit}
            />
          </Form.Item>

          <Form.Item
            name="category"
            label="Категория"
            rules={[{ required: true, message: 'Введите категорию' }]}
          >
            <Input placeholder="Например: площадь, масса, объем" />
          </Form.Item>

          <Form.Item
            name="sort_order"
            label="Порядок сортировки"
            rules={[{ required: true, message: 'Введите порядок сортировки' }]}
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder="Число для сортировки (0-999)"
            />
          </Form.Item>

          <Form.Item
            name="is_active"
            label="Статус"
            valuePropName="checked"
          >
            <Switch
              checkedChildren="Активна"
              unCheckedChildren="Неактивна"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
});

UnitsTab.displayName = 'UnitsTab';
