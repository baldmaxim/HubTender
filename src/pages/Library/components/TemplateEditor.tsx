import React from 'react';
import {
  Form,
  Input,
  Button,
  Space,
  AutoComplete,
  Divider,
  Row,
  Col,
} from 'antd';
import {
  PlusOutlined,
  SaveOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { TemplateItemsTable } from './TemplateItemsTable';
import type { TemplateItemWithDetails } from '../hooks/useTemplateItems';
import type { WorkLibraryFull, MaterialLibraryFull } from '../../../lib/supabase';

interface CostCategoryOption {
  value: string;
  label: string;
  cost_category_name: string;
  location: string;
}

interface TemplateEditorProps {
  form: any;
  templateItems: TemplateItemWithDetails[];
  costCategories: CostCategoryOption[];
  costCategorySearchText: string;
  setCostCategorySearchText: (text: string) => void;
  works: WorkLibraryFull[];
  workSearchText: string;
  setWorkSearchText: (text: string) => void;
  selectedWork: string | null;
  setSelectedWork: (id: string | null) => void;
  materials: MaterialLibraryFull[];
  materialSearchText: string;
  setMaterialSearchText: (text: string) => void;
  selectedMaterial: string | null;
  setSelectedMaterial: (id: string | null) => void;
  currentTheme: string;
  onAddWork: () => void;
  onAddMaterial: () => void;
  onSaveTemplate: () => void;
  onCancel: () => void;
  loading: boolean;
  getColumns: any;
  getRowClassName: any;
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  form,
  templateItems,
  costCategories,
  costCategorySearchText,
  setCostCategorySearchText,
  works,
  workSearchText,
  setWorkSearchText,
  setSelectedWork,
  materials,
  materialSearchText,
  setMaterialSearchText,
  setSelectedMaterial,
  currentTheme,
  onAddWork,
  onAddMaterial,
  onSaveTemplate,
  onCancel,
  loading,
  getColumns,
  getRowClassName,
}) => {
  const costCategoryOptions = costCategories
    .filter((c) => c.label.toLowerCase().includes(costCategorySearchText.toLowerCase()))
    .map((c) => ({
      value: c.label,
      id: c.value,
      label: c.label,
    }));

  const workOptions = works
    .filter((w) => w.work_name.toLowerCase().includes(workSearchText.toLowerCase()))
    .map((w) => ({
      key: w.id,
      value: w.work_name,
      id: w.id,
      label: w.work_name,
    }));

  const materialOptions = materials
    .filter((m) => m.material_name.toLowerCase().includes(materialSearchText.toLowerCase()))
    .map((m) => ({
      key: m.id,
      value: m.material_name,
      id: m.id,
      label: m.material_name,
    }));

  return (
    <Form form={form} layout="vertical">
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            label="Название шаблона"
            name="name"
            rules={[
              { required: true, message: 'Введите название шаблона' },
              { max: 100, message: 'Максимум 100 символов' },
            ]}
          >
            <Input
              placeholder="Например: Монтаж металлоконструкций"
              maxLength={100}
              showCount
            />
          </Form.Item>
        </Col>

        <Col span={12}>
          <Form.Item
            label="Затрата на строительство"
            required
          >
            <AutoComplete
              options={costCategoryOptions}
              placeholder="Начните вводить для поиска..."
              value={costCategorySearchText}
              onChange={setCostCategorySearchText}
              onSelect={(value, option: any) => {
                setCostCategorySearchText(value);
                form.setFieldValue('detail_cost_category_id', option.id);
              }}
              onClear={() => {
                setCostCategorySearchText('');
                form.setFieldValue('detail_cost_category_id', null);
              }}
              filterOption={false}
              showSearch
              allowClear
              popupClassName={currentTheme === 'dark' ? 'autocomplete-dark' : ''}
            />
            <Form.Item
              name="detail_cost_category_id"
              noStyle
              rules={[{ required: true, message: 'Выберите затрату на строительство' }]}
            >
              <Input type="hidden" />
            </Form.Item>
          </Form.Item>
        </Col>
      </Row>

      <Divider orientation="center" style={{ color: '#1890ff' }}>
        Добавление работ и материалов
      </Divider>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Space.Compact style={{ width: '100%' }}>
            <AutoComplete
              style={{ width: '100%' }}
              options={workOptions}
              value={workSearchText}
              onChange={setWorkSearchText}
              onSelect={(value, option: any) => {
                setWorkSearchText(value);
                setSelectedWork(option.id);
              }}
              placeholder="Введите работу (2+ символа)..."
              filterOption={false}
              popupClassName={currentTheme === 'dark' ? 'autocomplete-dark' : ''}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onAddWork}
            />
          </Space.Compact>
        </Col>

        <Col span={12}>
          <Space.Compact style={{ width: '100%' }}>
            <AutoComplete
              style={{ width: '100%' }}
              options={materialOptions}
              value={materialSearchText}
              onChange={setMaterialSearchText}
              onSelect={(value, option: any) => {
                setMaterialSearchText(value);
                setSelectedMaterial(option.id);
              }}
              placeholder="Введите материал (2+ символа)..."
              filterOption={false}
              popupClassName={currentTheme === 'dark' ? 'autocomplete-dark' : ''}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onAddMaterial}
            />
          </Space.Compact>
        </Col>
      </Row>

      <Divider orientation="center" style={{ color: '#1890ff' }}>
        Элементы шаблона
      </Divider>

      <TemplateItemsTable
        dataSource={templateItems}
        columns={getColumns(true, templateItems)}
        rowClassName={getRowClassName}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Space>
          <Button icon={<CloseOutlined />} onClick={onCancel}>
            Отмена
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={onSaveTemplate}
            loading={loading}
          >
            Сохранить шаблон
          </Button>
        </Space>
      </div>
    </Form>
  );
};
