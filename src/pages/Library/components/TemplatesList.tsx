import React, { useState, useEffect } from 'react';
import {
  Button,
  Space,
  Tag,
  Tooltip,
  Popconfirm,
  Typography,
  Table,
  Row,
  Col,
  AutoComplete,
  Form,
  Input,
  Dropdown,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  EditOutlined,
  DeleteOutlined,
  ExportOutlined,
  AppstoreAddOutlined,
  SaveOutlined,
  CloseOutlined,
  PlusOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import type { TemplateWithDetails } from '../hooks/useTemplates';
import type { TemplateItemWithDetails } from '../hooks/useTemplateItems';
import type { LibraryFolder } from '../../../lib/supabase';

const { Text } = Typography;

interface TemplatesListProps {
  templates: TemplateWithDetails[];
  loadedTemplateItems: Record<string, TemplateItemWithDetails[]>;
  openedTemplate: string | null;
  setOpenedTemplate: (id: string | null) => void;
  editingTemplate: string | null;
  editingTemplateForm: any;
  editingTemplateCostCategorySearchText: string;
  setEditingTemplateCostCategorySearchText: (text: string) => void;
  editingItems: TemplateItemWithDetails[];
  costCategories: any[];
  currentTheme: string;
  onEditTemplate: (template: TemplateWithDetails) => void;
  onCancelEditTemplate: () => void;
  onSaveEditTemplate: (templateId: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onOpenInsertModal: (templateId: string) => void;
  editingTemplateItems: string | null;
  setEditingTemplateItems: (id: string | null) => void;
  editingWorkSearchText: string;
  setEditingWorkSearchText: (text: string) => void;
  editingMaterialSearchText: string;
  setEditingMaterialSearchText: (text: string) => void;
  editingSelectedWork: string | null;
  setEditingSelectedWork: (id: string | null) => void;
  editingSelectedMaterial: string | null;
  setEditingSelectedMaterial: (id: string | null) => void;
  works: any[];
  materials: any[];
  onAddWorkToTemplate: (templateId: string) => void;
  onAddMaterialToTemplate: (templateId: string) => void;
  getColumns: any;
  getRowClassName: any;
  folders?: LibraryFolder[];
  onMoveTemplate?: (templateId: string, folderId: string | null) => void;
  selectedTemplateIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  bulkMoveLoading?: boolean;
  onBulkMove?: (folderId: string | null) => void;
  onClearSelection?: () => void;
  loadingTemplates?: Set<string>;
}

export const TemplatesList: React.FC<TemplatesListProps> = ({
  templates,
  loadedTemplateItems,
  openedTemplate,
  setOpenedTemplate,
  editingTemplate,
  editingTemplateForm,
  editingTemplateCostCategorySearchText,
  setEditingTemplateCostCategorySearchText,
  editingItems,
  costCategories,
  currentTheme,
  onEditTemplate,
  onCancelEditTemplate,
  onSaveEditTemplate,
  onDeleteTemplate,
  onOpenInsertModal,
  editingTemplateItems,
  setEditingTemplateItems,
  editingWorkSearchText,
  setEditingWorkSearchText,
  editingMaterialSearchText,
  setEditingMaterialSearchText,
  setEditingSelectedWork,
  setEditingSelectedMaterial,
  works,
  materials,
  onAddWorkToTemplate,
  onAddMaterialToTemplate,
  getColumns,
  getRowClassName,
  folders = [],
  onMoveTemplate,
  selectedTemplateIds = new Set(),
  onSelectionChange,
  bulkMoveLoading = false,
  onBulkMove,
  onClearSelection,
  loadingTemplates = new Set(),
}) => {
  const [tableScrollY, setTableScrollY] = useState(600);

  useEffect(() => {
    const update = () => setTableScrollY(Math.max(300, window.innerHeight - 64 - 200 - 8));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const bulkMenuItems = [
    { key: '__none__', label: 'Без папки', onClick: () => onBulkMove?.(null) },
    ...(folders.length > 0 ? [{ type: 'divider' as const }] : []),
    ...folders.map(f => ({ key: f.id, label: f.name, onClick: () => onBulkMove?.(f.id) })),
  ];

  const columns: ColumnsType<TemplateWithDetails> = [
    {
      title: 'Наименование шаблона',
      key: 'name',
      ellipsis: true,
      render: (_, template) => {
        const items = loadedTemplateItems[template.id] || [];
        const worksCount = items.filter(i => i.kind === 'work').length;
        const materialsCount = items.filter(i => i.kind === 'material').length;

        if (editingTemplate === template.id) {
          return (
            <Form
              form={editingTemplateForm}
              layout="inline"
              style={{ width: '100%' }}
              onClick={e => e.stopPropagation()}
            >
              <Form.Item
                name="name"
                rules={[{ required: true, message: 'Введите название' }]}
                style={{ flex: 1, minWidth: 180, marginRight: 8 }}
              >
                <Input placeholder="Название шаблона" />
              </Form.Item>
              <Form.Item style={{ flex: 1, minWidth: 220, marginRight: 8 }}>
                <AutoComplete
                  options={costCategories
                    .filter(c => c.label.toLowerCase().includes(editingTemplateCostCategorySearchText.toLowerCase()))
                    .map(c => ({ value: c.label, id: c.value, label: c.label }))}
                  placeholder="Затрата на строительство..."
                  value={editingTemplateCostCategorySearchText}
                  onChange={setEditingTemplateCostCategorySearchText}
                  onSelect={(value, option: any) => {
                    setEditingTemplateCostCategorySearchText(value);
                    editingTemplateForm.setFieldValue('detail_cost_category_id', option.id);
                  }}
                  onClear={() => {
                    setEditingTemplateCostCategorySearchText('');
                    editingTemplateForm.setFieldValue('detail_cost_category_id', null);
                  }}
                  filterOption={false}
                  showSearch
                  allowClear
                  style={{ width: '100%' }}
                  popupClassName={currentTheme === 'dark' ? 'autocomplete-dark' : undefined}
                />
                <Form.Item
                  name="detail_cost_category_id"
                  noStyle
                  rules={[{ required: true, message: 'Выберите затрату' }]}
                >
                  <Input type="hidden" />
                </Form.Item>
              </Form.Item>
              <Space>
                <Button type="primary" size="small" icon={<SaveOutlined />} onClick={() => onSaveEditTemplate(template.id)} />
                <Button size="small" icon={<CloseOutlined />} onClick={onCancelEditTemplate} />
              </Space>
            </Form>
          );
        }

        return (
          <Space direction="vertical" size={0}>
            <Space size={4}>
              <Text strong>{template.name}</Text>
              {template.cost_category_full && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  ({template.cost_category_full})
                </Text>
              )}
            </Space>
            {items.length > 0 && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                Работ: {worksCount} | Материалов: {materialsCount}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 290,
      fixed: 'right' as const,
      align: 'right' as const,
      render: (_, template) => {
        if (editingTemplate === template.id) return null;
        return (
          <Space size={4} onClick={e => e.stopPropagation()}>
            <Tooltip title="Вставить шаблон в строку Заказчика">
              <Tag
                style={{ cursor: 'pointer', userSelect: 'none' }}
                color="processing"
                icon={<ExportOutlined />}
                onClick={() => onOpenInsertModal(template.id)}
              >
                Вставить в позицию
              </Tag>
            </Tooltip>
            {folders.length > 0 && (
              <Dropdown
                menu={{
                  items: [
                    { key: '__none__', label: 'Без папки', onClick: () => onMoveTemplate?.(template.id, null) },
                    { type: 'divider' },
                    ...folders.map(f => ({ key: f.id, label: f.name, onClick: () => onMoveTemplate?.(template.id, f.id) })),
                  ],
                }}
                trigger={['click']}
              >
                <Tooltip title="Переместить в папку">
                  <Button type="text" size="small" icon={<FolderOutlined />} />
                </Tooltip>
              </Dropdown>
            )}
            <Tooltip title="Добавить работы/материалы в шаблон">
              <Button
                type="text"
                size="small"
                icon={<AppstoreAddOutlined />}
                style={{ color: editingTemplateItems === template.id ? '#1890ff' : undefined }}
                onClick={() => {
                  if (editingTemplateItems === template.id) {
                    setEditingTemplateItems(null);
                    setEditingWorkSearchText('');
                    setEditingMaterialSearchText('');
                    setEditingSelectedWork(null);
                    setEditingSelectedMaterial(null);
                  } else {
                    setEditingTemplateItems(template.id);
                  }
                }}
              />
            </Tooltip>
            <Tooltip title="Редактировать шаблон">
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => onEditTemplate(template)} />
            </Tooltip>
            <Popconfirm title="Удалить шаблон?" onConfirm={() => onDeleteTemplate(template.id)} okText="Да" cancelText="Нет">
              <Tooltip title="Удалить шаблон">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <>
      {/* Панель массового перемещения */}
      {selectedTemplateIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
          padding: '6px 10px', borderRadius: 6,
          background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)',
        }}>
          <span style={{ fontSize: 13 }}>Выбрано: <strong>{selectedTemplateIds.size}</strong></span>
          <Dropdown menu={{ items: bulkMenuItems }} trigger={['click']} disabled={bulkMoveLoading || folders.length === 0}>
            <Button size="small" icon={<FolderOutlined />} loading={bulkMoveLoading}>
              Переместить в папку
            </Button>
          </Dropdown>
          <Button size="small" onClick={onClearSelection}>Снять выбор</Button>
        </div>
      )}

      <div className="templates-virtual-table">
      <Table
        columns={columns}
        dataSource={templates}
        rowKey="id"
        virtual
        scroll={{ x: 'max-content', y: tableScrollY }}
        pagination={false}
        size="small"
        showHeader={false}
        rowSelection={{
          selectedRowKeys: [...selectedTemplateIds],
          onChange: (keys) => onSelectionChange?.(new Set(keys as string[])),
          columnWidth: 36,
        }}
        expandable={{
          expandedRowKeys: openedTemplate ? [openedTemplate] : [],
          onExpand: (expanded, record) => setOpenedTemplate(expanded ? record.id : null),
          columnWidth: 36,
          expandedRowRender: (template) => {
            const items = loadedTemplateItems[template.id] || [];

            if (loadingTemplates.has(template.id)) {
              return <Text type="secondary" style={{ paddingLeft: 8 }}>Загрузка элементов...</Text>;
            }
            if (items.length === 0) {
              return <Text type="secondary" style={{ paddingLeft: 8 }}>Шаблон не содержит элементов</Text>;
            }

            // expand column (36) + selection column (36) + cell padding (8) = 80px
            // Сдвигаем содержимое влево чтобы занять всю ширину внешней таблицы
            const offset = 80;

            return (
              <div style={{ marginLeft: -offset, width: `calc(100% + ${offset}px)` }}>
                {editingTemplateItems === template.id && (
                  <Row gutter={16} style={{ marginBottom: 16 }}>
                    <Col span={12}>
                      <Space.Compact style={{ width: '100%' }}>
                        <AutoComplete
                          style={{ width: '100%' }}
                          options={works
                            .filter(w => w.work_name.toLowerCase().includes(editingWorkSearchText.toLowerCase()))
                            .map(w => ({ value: `${w.work_name} (${w.unit})`, id: w.id, label: `${w.work_name} (${w.unit})` }))}
                          value={editingWorkSearchText}
                          onChange={setEditingWorkSearchText}
                          onSelect={(value, option: any) => {
                            setEditingWorkSearchText(value);
                            setEditingSelectedWork(option.id);
                          }}
                          placeholder="Введите работу (2+ символа)..."
                          filterOption={false}
                          popupClassName={currentTheme === 'dark' ? 'autocomplete-dark' : undefined}
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => onAddWorkToTemplate(template.id)} />
                      </Space.Compact>
                    </Col>
                    <Col span={12}>
                      <Space.Compact style={{ width: '100%' }}>
                        <AutoComplete
                          style={{ width: '100%' }}
                          options={materials
                            .filter(m => m.material_name.toLowerCase().includes(editingMaterialSearchText.toLowerCase()))
                            .map(m => ({ value: `${m.material_name} (${m.unit})`, id: m.id, label: `${m.material_name} (${m.unit})` }))}
                          value={editingMaterialSearchText}
                          onChange={setEditingMaterialSearchText}
                          onSelect={(value, option: any) => {
                            setEditingMaterialSearchText(value);
                            setEditingSelectedMaterial(option.id);
                          }}
                          placeholder="Введите материал (2+ символа)..."
                          filterOption={false}
                          popupClassName={currentTheme === 'dark' ? 'autocomplete-dark' : undefined}
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => onAddMaterialToTemplate(template.id)} />
                      </Space.Compact>
                    </Col>
                  </Row>
                )}
                <Table
                  dataSource={editingTemplate === template.id ? editingItems : items}
                  columns={getColumns(
                    false,
                    editingTemplate === template.id ? editingItems : items,
                    template.id,
                    editingTemplate === template.id,
                    editingTemplateItems === template.id
                  )}
                  rowKey="id"
                  rowClassName={getRowClassName}
                  pagination={false}
                  size="small"
                />
              </div>
            );
          },
        }}
      />
      </div>

      <style>{`
        .templates-virtual-table tr.ant-table-expanded-row > td {
          padding-left: 0 !important;
          padding-right: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
      `}</style>
    </>
  );
};
