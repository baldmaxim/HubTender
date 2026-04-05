import React, { useState, useMemo, useEffect } from 'react';
import { Form, message, Tabs, Typography, Button, Input, Modal, Space, Tooltip, Popconfirm } from 'antd';
import {
  AppstoreOutlined, FileOutlined, FolderOutlined, PlusOutlined,
  EditOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import InsertTemplateIntoPositionModal from './InsertTemplateIntoPositionModal';
import { useTemplates } from './hooks/useTemplates';
import { useTemplateItems } from './hooks/useTemplateItems';
import { useLibraryData } from './hooks/useLibraryData';
import { useTemplateCreation } from './hooks/useTemplateCreation';
import { useTemplateEditing } from './hooks/useTemplateEditing';
import { useFolders } from './hooks/useFolders';
import { TemplatesList } from './components/TemplatesList';
import { TemplateEditor } from './components/TemplateEditor';
import { TemplateFilters } from './components/TemplateFilters';
import { createTemplateColumns, getRowClassName } from './utils/templateColumns';
import { templateRowStyles } from './utils/templateStyles';
import type { TemplateItemWithDetails } from './hooks/useTemplateItems';
import type { LibraryFolder } from '../../lib/supabase';

const { Text } = Typography;

const Templates: React.FC = () => {
  const [form] = Form.useForm();
  const { theme: currentTheme } = useTheme();

  const { templates, loading, setLoading, fetchTemplates, handleDeleteTemplate } = useTemplates();
  const { folders, createFolder, renameFolder, deleteFolder, moveItem } = useFolders('templates');

  // Folder state
  const [activeFolder, setActiveFolder] = useState<string | null | 'none'>(null);
  const [createFolderModalOpen, setCreateFolderModalOpen] = useState(false);
  const [renameFolderTarget, setRenameFolderTarget] = useState<LibraryFolder | null>(null);
  const [folderInputValue, setFolderInputValue] = useState('');
  const [folderModalSaving, setFolderModalSaving] = useState(false);
  const {
    loadedTemplateItems,
    loadingTemplates,
    setLoadedTemplateItems,
    fetchTemplateItems,
    refetchTemplateItems,
    handleDeleteTemplateItem,
  } = useTemplateItems();
  const { works, materials, costCategories } = useLibraryData();

  const {
    templateItems,
    setTemplateItems,
    selectedWork,
    setSelectedWork,
    selectedMaterial,
    setSelectedMaterial,
    addWork,
    addMaterial,
    deleteItem,
    saveTemplate,
    resetCreation,
  } = useTemplateCreation(works, materials, costCategories);

  const {
    editingTemplateForm,
    editingTemplate,
    editingTemplateCostCategorySearchText,
    setEditingTemplateCostCategorySearchText,
    editingItems,
    setEditingItems,
    startEditing,
    cancelEditing,
    saveEditing,
    addWorkToTemplate,
    addMaterialToTemplate,
  } = useTemplateEditing(loadedTemplateItems, setLoadedTemplateItems, costCategories);

  const [activeTab, setActiveTab] = useState<string>('list');
  const [workSearchText, setWorkSearchText] = useState('');
  const [materialSearchText, setMaterialSearchText] = useState('');
  const [costCategorySearchText, setCostCategorySearchText] = useState('');

  const [editingTemplateItems, setEditingTemplateItems] = useState<string | null>(null);
  const [editingWorkSearchText, setEditingWorkSearchText] = useState('');
  const [editingMaterialSearchText, setEditingMaterialSearchText] = useState('');
  const [editingSelectedWork, setEditingSelectedWork] = useState<string | null>(null);
  const [editingSelectedMaterial, setEditingSelectedMaterial] = useState<string | null>(null);

  const [templateSearchText, setTemplateSearchText] = useState('');
  const [filterCostCategory, setFilterCostCategory] = useState<string | null>(null);
  const [filterDetailCategory, setFilterDetailCategory] = useState<string | null>(null);
  const [openedTemplate, setOpenedTemplate] = useState<string | null>(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  const [bulkMoveLoading, setBulkMoveLoading] = useState(false);

  const [insertModalOpen, setInsertModalOpen] = useState(false);
  const [selectedTemplateForInsert, setSelectedTemplateForInsert] = useState<string | null>(null);

  // Ленивая загрузка: загружаем элементы только при открытии аккордеона
  useEffect(() => {
    if (openedTemplate) {
      fetchTemplateItems(openedTemplate);
    }
  }, [openedTemplate]);

  const handleAddWork = () => {
    if (!selectedWork) {
      message.warning('Выберите работу');
      return;
    }
    const work = works.find((w) => w.id === selectedWork);
    if (!work) return;

    const templateCostCategoryId = form.getFieldValue('detail_cost_category_id');
    addWork(work, templateCostCategoryId);
    setSelectedWork(null);
    setWorkSearchText('');
  };

  const handleAddMaterial = () => {
    if (!selectedMaterial) {
      message.warning('Выберите материал');
      return;
    }
    const material = materials.find((m) => m.id === selectedMaterial);
    if (!material) return;

    const templateCostCategoryId = form.getFieldValue('detail_cost_category_id');
    addMaterial(material, templateCostCategoryId);
    setSelectedMaterial(null);
    setMaterialSearchText('');
  };

  const handleSaveTemplate = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const success = await saveTemplate(values.name, values.detail_cost_category_id);
      if (success) {
        message.success('Шаблон успешно создан');
        form.resetFields();
        resetCreation();
        setWorkSearchText('');
        setMaterialSearchText('');
        setCostCategorySearchText('');
        fetchTemplates();
      }
    } catch (error: any) {
      message.error('Ошибка создания шаблона: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    resetCreation();
    setWorkSearchText('');
    setMaterialSearchText('');
    setCostCategorySearchText('');
  };

  const handleUpdateItemCoeff = (id: string, value: number | null, templateId?: string) => {
    if (editingTemplate) {
      setEditingItems(editingItems.map((item) => (item.id === id ? { ...item, conversation_coeff: value } : item)));
    } else if (templateId) {
      setLoadedTemplateItems(prev => ({
        ...prev,
        [templateId]: (prev[templateId] || []).map((item) => (item.id === id ? { ...item, conversation_coeff: value } : item)),
      }));
    } else {
      setTemplateItems(templateItems.map((item) => (item.id === id ? { ...item, conversation_coeff: value } : item)));
    }
  };

  const handleUpdateItemParent = (id: string, parentId: string | null, templateId?: string) => {
    if (editingTemplate) {
      setEditingItems(editingItems.map((item) => (item.id === id ? { ...item, parent_work_item_id: parentId } : item)));
    } else if (templateId) {
      setLoadedTemplateItems(prev => ({
        ...prev,
        [templateId]: (prev[templateId] || []).map((item) => (item.id === id ? { ...item, parent_work_item_id: parentId } : item)),
      }));
    } else {
      setTemplateItems(templateItems.map((item) => (item.id === id ? { ...item, parent_work_item_id: parentId } : item)));
    }
  };

  const handleAddWorkToTemplate = async (templateId: string) => {
    if (!editingSelectedWork) {
      message.warning('Выберите работу');
      return;
    }
    try {
      const work = works.find((w) => w.id === editingSelectedWork);
      if (!work) return;
      await addWorkToTemplate(templateId, work);
      setEditingSelectedWork(null);
      setEditingWorkSearchText('');
    } catch (error: any) {
      message.error('Ошибка добавления работы: ' + error.message);
    }
  };

  const handleAddMaterialToTemplate = async (templateId: string) => {
    if (!editingSelectedMaterial) {
      message.warning('Выберите материал');
      return;
    }
    try {
      const material = materials.find((m) => m.id === editingSelectedMaterial);
      if (!material) return;
      await addMaterialToTemplate(templateId, material);
      setEditingSelectedMaterial(null);
      setEditingMaterialSearchText('');
    } catch (error: any) {
      message.error('Ошибка добавления материала: ' + error.message);
    }
  };

  const getCostCategoryOptions = (searchText: string) => {
    return costCategories
      .filter((c) => c.label.toLowerCase().includes(searchText.toLowerCase()))
      .map((c) => ({
        value: c.label,
        id: c.value,
        label: c.label,
      }));
  };

  const getColumns = (
    isCreating: boolean = false,
    currentItems: TemplateItemWithDetails[] = [],
    templateId?: string,
    isEditing: boolean = false,
    isAddingItems: boolean = false
  ) => {
    return createTemplateColumns(
      isCreating,
      currentItems,
      templateId,
      isEditing,
      isAddingItems,
      currentTheme,
      {
        handleUpdateItemParent,
        handleUpdateItemCoeff,
        handleDeleteItem: deleteItem,
        handleDeleteTemplateItem,
        getCostCategoryOptions,
        setTemplateItems,
        setEditingItems,
        setLoadedTemplateItems,
      }
    );
  };

  const handleCreateFolder = async () => {
    if (!folderInputValue.trim()) return;
    setFolderModalSaving(true);
    try {
      await createFolder(folderInputValue.trim());
      setCreateFolderModalOpen(false);
      setFolderInputValue('');
    } catch { /* handled in hook */ } finally {
      setFolderModalSaving(false);
    }
  };

  const handleRenameFolder = async () => {
    if (!renameFolderTarget || !folderInputValue.trim()) return;
    setFolderModalSaving(true);
    try {
      await renameFolder(renameFolderTarget.id, folderInputValue.trim());
      setRenameFolderTarget(null);
      setFolderInputValue('');
    } catch { /* handled in hook */ } finally {
      setFolderModalSaving(false);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    await deleteFolder(folderId);
    if (activeFolder === folderId) setActiveFolder(null);
  };

  const handleMoveTemplate = async (templateId: string, folderId: string | null) => {
    try {
      await moveItem('templates', templateId, folderId);
      fetchTemplates();
    } catch {
      message.error('Ошибка при перемещении');
    }
  };

  const handleBulkMoveTemplates = async (folderId: string | null) => {
    setBulkMoveLoading(true);
    try {
      await Promise.all([...selectedTemplateIds].map(id => moveItem('templates', id, folderId)));
      fetchTemplates();
      setSelectedTemplateIds(new Set());
    } catch {
      message.error('Ошибка при перемещении');
    } finally {
      setBulkMoveLoading(false);
    }
  };

  const filteredTemplates = useMemo(() => templates.filter((template) => {
    if (templateSearchText.length >= 2 && !template.name.toLowerCase().includes(templateSearchText.toLowerCase())) {
      return false;
    }
    if (filterCostCategory && template.cost_category_name !== filterCostCategory) {
      return false;
    }
    if (filterDetailCategory && template.detail_category_name !== filterDetailCategory) {
      return false;
    }
    if (activeFolder === 'none' && template.folder_id) return false;
    if (activeFolder && activeFolder !== 'none' && template.folder_id !== activeFolder) return false;
    return true;
  }), [templates, templateSearchText, filterCostCategory, filterDetailCategory, activeFolder]);

  return (
    <div style={{ margin: '-16px', padding: '24px' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'list',
            label: 'Список шаблонов',
            children: (
              <div>
                {/* Панель фильтров папок */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Button
                    size="small"
                    type={activeFolder === null ? 'primary' : 'default'}
                    icon={<AppstoreOutlined />}
                    onClick={() => setActiveFolder(null)}
                  >
                    Все
                  </Button>
                  <Button
                    size="small"
                    type={activeFolder === 'none' ? 'primary' : 'default'}
                    icon={<FileOutlined />}
                    onClick={() => setActiveFolder('none')}
                  >
                    Без папки
                  </Button>
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => { setFolderInputValue(''); setCreateFolderModalOpen(true); }}
                  >
                    Создать папку
                  </Button>
                </div>

                {/* Строки папок */}
                {folders.map(folder => (
                  <div
                    key={folder.id}
                    onClick={() => setActiveFolder(activeFolder === folder.id ? null : folder.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 12px',
                      marginBottom: 4,
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: activeFolder === folder.id
                        ? 'rgba(250, 173, 20, 0.22)'
                        : 'rgba(250, 173, 20, 0.08)',
                      border: '1px solid rgba(250, 173, 20, 0.2)',
                      transition: 'background 0.15s',
                    }}
                  >
                    <FolderOutlined style={{ color: '#faad14', fontSize: 15, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, flex: 1 }}>{folder.name}</span>
                    <Space size={4} onClick={e => e.stopPropagation()}>
                      <Tooltip title="Переименовать">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => { setRenameFolderTarget(folder); setFolderInputValue(folder.name); }}
                        />
                      </Tooltip>
                      <Popconfirm
                        title={`Удалить папку «${folder.name}»?`}
                        onConfirm={() => handleDeleteFolder(folder.id)}
                        okText="Удалить"
                        okType="danger"
                        cancelText="Отмена"
                      >
                        <Tooltip title="Удалить">
                          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                        </Tooltip>
                      </Popconfirm>
                    </Space>
                  </div>
                ))}

                <TemplateFilters
                  templates={templates}
                  templateSearchText={templateSearchText}
                  setTemplateSearchText={setTemplateSearchText}
                  filterCostCategory={filterCostCategory}
                  setFilterCostCategory={setFilterCostCategory}
                  filterDetailCategory={filterDetailCategory}
                  setFilterDetailCategory={setFilterDetailCategory}
                  currentTheme={currentTheme}
                />

                <TemplatesList
                  templates={filteredTemplates}
                  loadedTemplateItems={loadedTemplateItems}
                  openedTemplate={openedTemplate}
                  setOpenedTemplate={setOpenedTemplate}
                  editingTemplate={editingTemplate}
                  editingTemplateForm={editingTemplateForm}
                  editingTemplateCostCategorySearchText={editingTemplateCostCategorySearchText}
                  setEditingTemplateCostCategorySearchText={setEditingTemplateCostCategorySearchText}
                  editingItems={editingItems}
                  costCategories={costCategories}
                  currentTheme={currentTheme}
                  onEditTemplate={startEditing}
                  onCancelEditTemplate={cancelEditing}
                  onSaveEditTemplate={(templateId) => saveEditing(templateId, setOpenedTemplate, fetchTemplates, refetchTemplateItems)}
                  onDeleteTemplate={handleDeleteTemplate}
                  onOpenInsertModal={(templateId) => {
                    setSelectedTemplateForInsert(templateId);
                    setInsertModalOpen(true);
                  }}
                  editingTemplateItems={editingTemplateItems}
                  setEditingTemplateItems={setEditingTemplateItems}
                  editingWorkSearchText={editingWorkSearchText}
                  setEditingWorkSearchText={setEditingWorkSearchText}
                  editingMaterialSearchText={editingMaterialSearchText}
                  setEditingMaterialSearchText={setEditingMaterialSearchText}
                  editingSelectedWork={editingSelectedWork}
                  setEditingSelectedWork={setEditingSelectedWork}
                  editingSelectedMaterial={editingSelectedMaterial}
                  setEditingSelectedMaterial={setEditingSelectedMaterial}
                  works={works}
                  materials={materials}
                  onAddWorkToTemplate={handleAddWorkToTemplate}
                  onAddMaterialToTemplate={handleAddMaterialToTemplate}
                  getColumns={getColumns}
                  getRowClassName={getRowClassName}
                  folders={folders}
                  onMoveTemplate={handleMoveTemplate}
                  selectedTemplateIds={selectedTemplateIds}
                  onSelectionChange={setSelectedTemplateIds}
                  bulkMoveLoading={bulkMoveLoading}
                  onBulkMove={handleBulkMoveTemplates}
                  onClearSelection={() => setSelectedTemplateIds(new Set())}
                  loadingTemplates={loadingTemplates}
                />

                {filteredTemplates.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '40px 0' }}>
                    <Text type="secondary">
                      {templates.length === 0 ? 'Нет созданных шаблонов' : 'Нет шаблонов, соответствующих критериям поиска'}
                    </Text>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'create',
            label: 'Создание шаблона',
            children: (
              <TemplateEditor
                form={form}
                templateItems={templateItems}
                costCategories={costCategories}
                costCategorySearchText={costCategorySearchText}
                setCostCategorySearchText={setCostCategorySearchText}
                works={works}
                workSearchText={workSearchText}
                setWorkSearchText={setWorkSearchText}
                selectedWork={selectedWork}
                setSelectedWork={setSelectedWork}
                materials={materials}
                materialSearchText={materialSearchText}
                setMaterialSearchText={setMaterialSearchText}
                selectedMaterial={selectedMaterial}
                setSelectedMaterial={setSelectedMaterial}
                currentTheme={currentTheme}
                onAddWork={handleAddWork}
                onAddMaterial={handleAddMaterial}
                onSaveTemplate={handleSaveTemplate}
                onCancel={handleCancel}
                loading={loading}
                getColumns={getColumns}
                getRowClassName={getRowClassName}
              />
            ),
          },
        ]}
      />

      <InsertTemplateIntoPositionModal
        open={insertModalOpen}
        templateId={selectedTemplateForInsert}
        onCancel={() => {
          setInsertModalOpen(false);
          setSelectedTemplateForInsert(null);
        }}
        onSuccess={() => {
          setInsertModalOpen(false);
          setSelectedTemplateForInsert(null);
        }}
      />

      {/* Модал создания папки */}
      <Modal
        title="Создать папку"
        open={createFolderModalOpen}
        onOk={handleCreateFolder}
        onCancel={() => setCreateFolderModalOpen(false)}
        okText="Создать"
        cancelText="Отмена"
        confirmLoading={folderModalSaving}
        destroyOnClose
      >
        <Input
          placeholder="Название папки"
          value={folderInputValue}
          onChange={e => setFolderInputValue(e.target.value)}
          onPressEnter={handleCreateFolder}
          autoFocus
          maxLength={100}
        />
      </Modal>

      {/* Модал переименования папки */}
      <Modal
        title="Переименовать папку"
        open={!!renameFolderTarget}
        onOk={handleRenameFolder}
        onCancel={() => { setRenameFolderTarget(null); setFolderInputValue(''); }}
        okText="Сохранить"
        cancelText="Отмена"
        confirmLoading={folderModalSaving}
        destroyOnClose
      >
        <Input
          placeholder="Новое название"
          value={folderInputValue}
          onChange={e => setFolderInputValue(e.target.value)}
          onPressEnter={handleRenameFolder}
          autoFocus
          maxLength={100}
        />
      </Modal>

      <style>{templateRowStyles}</style>
    </div>
  );
};

export default Templates;
