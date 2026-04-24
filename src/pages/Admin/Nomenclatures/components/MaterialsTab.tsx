import React, { useState, useImperativeHandle, forwardRef } from 'react';
import { Table, Button, Space, Tooltip, Tag, Modal, Form, AutoComplete, Select } from 'antd';
import { EditOutlined, DeleteOutlined, FilterOutlined, ClearOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { MaterialRecord } from '../hooks/useMaterials.tsx';

interface MaterialsTabProps {
  data: MaterialRecord[];
  loading: boolean;
  unitsList: {code: string, name: string}[];
  unitColors: Record<string, string>;
  currentPage: number;
  pageSize: number;
  showDuplicatesOnly: boolean;
  duplicatesCount: number;
  onDelete: (record: MaterialRecord) => void;
  onSave: (values: { name: string; unit: string }, editingId?: string) => Promise<boolean>;
  onPageChange: (page: number, newPageSize: number) => void;
  onToggleDuplicates: () => void;
  onDeleteDuplicates: () => void;
}

export interface MaterialsTabRef {
  openAddModal: () => void;
}

export const MaterialsTab = forwardRef<MaterialsTabRef, MaterialsTabProps>(({
  data,
  loading,
  unitsList,
  unitColors,
  currentPage,
  pageSize,
  showDuplicatesOnly,
  duplicatesCount,
  onDelete,
  onSave,
  onPageChange,
  onToggleDuplicates,
  onDeleteDuplicates,
}, ref) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialRecord | null>(null);
  const [form] = Form.useForm();

  useImperativeHandle(ref, () => ({
    openAddModal: () => {
      setEditingMaterial(null);
      form.resetFields();
      setModalOpen(true);
    },
  }));

  const handleEditClick = (record: MaterialRecord) => {
    setEditingMaterial(record);
    form.setFieldsValue({
      name: record.name,
      unit: record.unit,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const success = await onSave(values, editingMaterial?.id);
      if (success) {
        setModalOpen(false);
        form.resetFields();
      }
    } catch (error) {
      console.error('Validation error:', error);
    }
  };

  const columns: ColumnsType<MaterialRecord> = [
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
      sorter: (a, b) => a.name.localeCompare(b.name, 'ru'),
    },
    {
      title: 'Единица измерения',
      dataIndex: 'unit',
      key: 'unit',
      width: 150,
      align: 'center',
      render: (unit: string) => (
        <Tag color={unitColors[unit] || 'default'}>{unit}</Tag>
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
      render: (_: unknown, record: MaterialRecord) => (
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
      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <Button
          icon={<FilterOutlined />}
          onClick={onToggleDuplicates}
          type={showDuplicatesOnly ? 'primary' : 'default'}
        >
          {showDuplicatesOnly ? 'Показать все' : 'Показать дубли'}
        </Button>
        <Button
          icon={<ClearOutlined />}
          danger
          disabled={duplicatesCount === 0}
          onClick={onDeleteDuplicates}
        >
          Удалить дубли{duplicatesCount > 0 ? ` (${duplicatesCount})` : ''}
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={paginationConfig}
        size="middle"
        scroll={{ y: 'calc(100vh - 340px)' }}
      />

      <Modal
        title={editingMaterial ? 'Редактировать материал' : 'Добавить материал'}
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
            label="Наименование материала"
            rules={[
              { required: true, message: 'Введите наименование материала' },
              {
                validator: async (_, value) => {
                  if (!value) return;
                  const isDuplicate = data.some(
                    item => item.name.toLowerCase() === value.toLowerCase() &&
                            (!editingMaterial || item.id !== editingMaterial.id)
                  );
                  if (isDuplicate) {
                    throw new Error('Материал с таким наименованием уже существует');
                  }
                },
              },
            ]}
          >
            <AutoComplete
              placeholder="Например: Кирпич керамический"
              options={data.map(item => ({ value: item.name }))}
              filterOption={(inputValue, option) =>
                option?.value.toLowerCase().includes(inputValue.toLowerCase()) || false
              }
            />
          </Form.Item>

          <Form.Item
            name="unit"
            label="Единица измерения"
            rules={[{ required: true, message: 'Выберите единицу измерения' }]}
          >
            <Select
              showSearch
              placeholder="Выберите или введите единицу измерения"
              optionFilterProp="children"
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={unitsList.map(unit => ({
                value: unit.code,
                label: `${unit.name} (${unit.code})`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
});

MaterialsTab.displayName = 'MaterialsTab';
