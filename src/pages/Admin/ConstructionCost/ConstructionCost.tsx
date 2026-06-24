import React, { useState, useEffect } from 'react';
import { Button, Space, Modal, Form, Typography } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  ExpandOutlined,
  CompressOutlined,
} from '@ant-design/icons';
import { useConstructionCost, TreeNode } from './hooks/useConstructionCost.tsx';
import { useUnitsManagement } from './hooks/useUnitsManagement';
import { useCategoryActions } from './hooks/useCategoryActions.tsx';
import { CostTable } from './components/CostTable';
import { ImportExcel } from './components/ImportExcel';
import { CostModals } from './components/CostModals';

const { confirm } = Modal;
const { Title } = Typography;

const unitColors: Record<string, string> = {
  'шт': 'blue',
  'м': 'green',
  'м2': 'cyan',
  'м3': 'purple',
  'кг': 'orange',
  'т': 'red',
  'л': 'magenta',
  'компл': 'volcano',
  'м.п.': 'geekblue',
  'точка': 'gold',
  'км': 'lime',
  'прибор': 'pink',
  'пог.м': 'teal',
  'упак': 'brown',
};

const ConstructionCost: React.FC = () => {
  const cost = useConstructionCost();
  const units = useUnitsManagement();
  const categoryActions = useCategoryActions(cost.loadData);

  const [uploading, setUploading] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<TreeNode | null>(null);
  const [sqlModalOpen, setSqlModalOpen] = useState(false);
  const [sqlContent, setSqlContent] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [addCategoryModalOpen, setAddCategoryModalOpen] = useState(false);
  const [addDetailModalOpen, setAddDetailModalOpen] = useState(false);
  const [addLocationModalOpen, setAddLocationModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<TreeNode | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<TreeNode | null>(null);

  const [form] = Form.useForm();
  const [addCategoryForm] = Form.useForm();
  const [addDetailForm] = Form.useForm();
  const [addLocationForm] = Form.useForm();

  useEffect(() => {
    const init = async () => {
      await units.loadUnits();
      await cost.loadData();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEdit = (record: TreeNode) => {
    setEditingItem(record);
    form.setFieldsValue({
      name: record.name ?? record.structure,
      unit: record.unit,
      location: record.location,
    });
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    try {
      const values = await form.validateFields();
      const success = await cost.saveEdit(values, editingItem);
      if (success) {
        setEditModalOpen(false);
        form.resetFields();
      }
    } catch (error) {
      console.error('Validation error:', error);
    }
  };

  const handleAddCategory = async () => {
    try {
      const values = await addCategoryForm.validateFields();
      const success = await categoryActions.addCategory(values);
      if (success) {
        setAddCategoryModalOpen(false);
        addCategoryForm.resetFields();
      }
    } catch (error) {
      console.error('Validation error:', error);
    }
  };

  const handleAddDetail = (category: TreeNode) => {
    setSelectedCategory(category);
    setAddDetailModalOpen(true);
  };

  const handleSaveDetail = async () => {
    try {
      const values = await addDetailForm.validateFields();
      const success = await categoryActions.addDetail(values, selectedCategory?.categoryId);
      if (success) {
        setAddDetailModalOpen(false);
        addDetailForm.resetFields();
      }
    } catch (error) {
      console.error('Validation error:', error);
    }
  };

  const handleAddLocation = (detail: TreeNode) => {
    setSelectedDetail(detail);
    setAddLocationModalOpen(true);
  };

  const handleSaveLocation = async () => {
    try {
      const values = await addLocationForm.validateFields();
      const success = await categoryActions.addLocation(values, selectedDetail);
      if (success) {
        setAddLocationModalOpen(false);
        addLocationForm.resetFields();
      }
    } catch (error) {
      console.error('Validation error:', error);
    }
  };

  const handleDeleteAll = () => {
    confirm({
      title: 'Удалить все затраты?',
      icon: <ExclamationCircleOutlined />,
      content: 'Это действие удалит все категории и детализации. Отменить операцию будет невозможно.',
      okText: 'Удалить',
      okType: 'danger',
      cancelText: 'Отмена',
      onOk: cost.deleteAll,
    });
  };

  return (
    <div style={{ margin: '-16px', padding: '24px' }}>
      <Title level={4} style={{ margin: '0 0 16px 0' }}>
        Справочник затрат
      </Title>
      <div>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Button
              icon={<ExpandOutlined />}
              onClick={cost.expandAll}
            >
              Раскрыть все
            </Button>
            <Button
              icon={<CompressOutlined />}
              onClick={cost.collapseAll}
            >
              Свернуть все
            </Button>
          </Space>
          <Space>
            <ImportExcel
              availableUnits={units.availableUnits}
              uploading={uploading}
              setUploading={setUploading}
              setImportErrors={setImportErrors}
              setSqlContent={setSqlContent}
              setSqlModalOpen={setSqlModalOpen}
              loadUnits={units.loadUnits}
              loadData={cost.loadData}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddCategoryModalOpen(true)}
            >
              Добавить категорию
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleDeleteAll}
            >
              Удалить затраты
            </Button>
          </Space>
        </div>

        <CostTable
          data={cost.data}
          loading={cost.loading}
          expandedKeys={cost.expandedKeys}
          unitColors={unitColors}
          onExpandedKeysChange={cost.setExpandedKeys}
          onEdit={handleEdit}
          onDelete={cost.deleteItem}
          onAddDetail={handleAddDetail}
          onAddLocation={handleAddLocation}
        />
      </div>

      <CostModals
        editModalOpen={editModalOpen}
        editingItem={editingItem}
        form={form}
        unitsData={units.unitsData}
        sqlModalOpen={sqlModalOpen}
        sqlContent={sqlContent}
        importErrors={importErrors}
        addCategoryModalOpen={addCategoryModalOpen}
        addDetailModalOpen={addDetailModalOpen}
        addLocationModalOpen={addLocationModalOpen}
        selectedCategory={selectedCategory}
        selectedDetail={selectedDetail}
        addCategoryForm={addCategoryForm}
        addDetailForm={addDetailForm}
        addLocationForm={addLocationForm}
        onEditSave={handleSaveEdit}
        onEditCancel={() => {
          setEditModalOpen(false);
          form.resetFields();
        }}
        onSqlClose={() => {
          setSqlModalOpen(false);
          setSqlContent('');
        }}
        onImportErrorsClose={() => setImportErrors([])}
        onAddCategorySave={handleAddCategory}
        onAddCategoryCancel={() => {
          setAddCategoryModalOpen(false);
          addCategoryForm.resetFields();
        }}
        onAddDetailSave={handleSaveDetail}
        onAddDetailCancel={() => {
          setAddDetailModalOpen(false);
          addDetailForm.resetFields();
        }}
        onAddLocationSave={handleSaveLocation}
        onAddLocationCancel={() => {
          setAddLocationModalOpen(false);
          addLocationForm.resetFields();
        }}
      />
    </div>
  );
};

export default ConstructionCost;
