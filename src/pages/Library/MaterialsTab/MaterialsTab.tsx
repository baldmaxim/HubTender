import { forwardRef, useImperativeHandle, useState, useEffect } from 'react';
import { Table, Form, Button, Dropdown, message, Input, Modal, Space, Tooltip, Popconfirm } from 'antd';
import {
  FolderOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  AppstoreOutlined, FileOutlined,
} from '@ant-design/icons';
import { MaterialLibraryFull } from '../../../lib/supabase';
import type { LibraryFolder } from '../../../lib/supabase';
import { useMaterialsData } from './hooks/useMaterialsData';
import { useMaterialsActions } from './hooks/useMaterialsActions';
import { MaterialsAddForm } from './components/MaterialsAddForm';
import { getMaterialsTableColumns } from './components/MaterialsTableColumns';
import { MaterialsEditableCell } from './components/MaterialsEditableCell';
import { useFolders } from '../hooks/useFolders';

interface MaterialsTabProps {
  searchText: string;
}

type FolderRow = LibraryFolder & { _type: 'folder' };

const MaterialsTab = forwardRef<any, MaterialsTabProps>((props, ref) => {
  const { searchText } = props;
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [activeFolder, setActiveFolder] = useState<string | null | 'none'>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Folder modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FolderRow | null>(null);
  const [folderInputValue, setFolderInputValue] = useState('');
  const [folderModalSaving, setFolderModalSaving] = useState(false);

  const { data, loading, materialNames, fetchMaterials } = useMaterialsData();
  const actions = useMaterialsActions(materialNames, fetchMaterials);
  const { folders, createFolder, renameFolder, deleteFolder, moveItem } = useFolders('materials');

  useEffect(() => {
    setSelectedRowKeys([]);
    setCurrentPage(1);
  }, [activeFolder]);

  useImperativeHandle(ref, () => ({
    handleAdd: actions.handleAdd,
  }));

  const handleMove = async (id: string, folderId: string | null) => {
    try {
      await moveItem('materials_library', id, folderId);
      fetchMaterials();
    } catch {
      message.error('Ошибка при перемещении');
    }
  };

  const handleBulkMove = async (folderId: string | null) => {
    setBulkLoading(true);
    try {
      await Promise.all(selectedRowKeys.map(id => moveItem('materials_library', id as string, folderId)));
      fetchMaterials();
      setSelectedRowKeys([]);
    } catch {
      message.error('Ошибка при перемещении');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!folderInputValue.trim()) return;
    setFolderModalSaving(true);
    try {
      await createFolder(folderInputValue.trim());
      setCreateModalOpen(false);
      setFolderInputValue('');
    } catch {
      // handled in hook
    } finally {
      setFolderModalSaving(false);
    }
  };

  const handleRenameFolder = async () => {
    if (!renameTarget || !folderInputValue.trim()) return;
    setFolderModalSaving(true);
    try {
      await renameFolder(renameTarget.id, folderInputValue.trim());
      setRenameTarget(null);
      setFolderInputValue('');
    } catch {
      // handled in hook
    } finally {
      setFolderModalSaving(false);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    await deleteFolder(folderId);
    if (activeFolder === folderId) setActiveFolder(null);
  };

  const getRowClassName = (record: any) => {
    if (record._type === 'folder') {
      return activeFolder === record.id ? 'folder-row folder-row-active' : 'folder-row';
    }
    if (actions.isEditing(record)) return 'editable-row';
    switch (record.item_type) {
      case 'мат': return 'material-row-mat';
      case 'суб-мат': return 'material-row-sub-mat';
      case 'мат-комп.': return 'material-row-mat-comp';
      default: return '';
    }
  };

  const baseColumns = getMaterialsTableColumns({
    currentPage,
    pageSize,
    isEditing: actions.isEditing,
    onEdit: actions.edit,
    onSave: actions.save,
    onCancel: actions.cancel,
    onDelete: actions.handleDelete,
    editingKey: actions.editingKey,
    selectedUnit: actions.selectedUnit,
  });

  const mergedColumns = baseColumns.map((col: any) => {
    if (!col.editable) return col;
    return {
      ...col,
      onCell: (record: any) => ({
        record,
        dataIndex: col.dataIndex,
        title: col.title,
        editing: actions.isEditing(record),
        materialNames,
        onMaterialNameSelect: actions.handleMaterialNameSelect,
      }),
    };
  });

  // Override columns to handle folder rows
  const finalColumns = mergedColumns.map((col: any) => ({
    ...col,
    onCell: (record: any) => {
      if (record._type === 'folder') return {};
      return col.onCell ? col.onCell(record) : {};
    },
    render: (value: any, record: any, index: number) => {
      if (record._type === 'folder') {
        if (col.dataIndex === 'material_name') {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FolderOutlined style={{ color: '#faad14', fontSize: 15 }} />
              <span style={{ fontWeight: 600 }}>{record.name}</span>
            </div>
          );
        }
        if (col.dataIndex === 'operation') {
          return (
            <Space size="small">
              <Tooltip title="Переименовать">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenameTarget(record);
                    setFolderInputValue(record.name);
                  }}
                />
              </Tooltip>
              <Popconfirm
                title={`Удалить папку «${record.name}»?`}
                onConfirm={() => handleDeleteFolder(record.id)}
                okText="Удалить"
                okType="danger"
                cancelText="Отмена"
              >
                <Tooltip title="Удалить">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={e => e.stopPropagation()}
                  />
                </Tooltip>
              </Popconfirm>
            </Space>
          );
        }
        return null;
      }
      return col.render ? col.render(value, record, index) : value;
    },
  }));

  const filteredData = data.filter(item => {
    if (!item.material_name.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (activeFolder === null) return true;
    if (activeFolder === 'none') return !item.folder_id;
    return item.folder_id === activeFolder;
  });

  const folderRows: FolderRow[] = folders.map(f => ({ ...f, _type: 'folder' as const }));
  const tableData = [...folderRows, ...filteredData];

  const bulkMenuItems = [
    { key: '__none__', label: 'Без папки', onClick: () => handleBulkMove(null) },
    ...(folders.length > 0 ? [{ type: 'divider' as const }] : []),
    ...folders.map(f => ({ key: f.id, label: f.name, onClick: () => handleBulkMove(f.id) })),
  ];

  return (
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
          onClick={() => { setFolderInputValue(''); setCreateModalOpen(true); }}
        >
          Создать папку
        </Button>
      </div>

      {/* Панель массового перемещения */}
      {selectedRowKeys.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
          padding: '6px 10px', borderRadius: 6,
          background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)',
        }}>
          <span style={{ fontSize: 13 }}>Выбрано: <strong>{selectedRowKeys.length}</strong></span>
          <Dropdown menu={{ items: bulkMenuItems }} trigger={['click']} disabled={bulkLoading}>
            <Button size="small" icon={<FolderOutlined />} loading={bulkLoading}>
              Переместить в папку
            </Button>
          </Dropdown>
          <Button size="small" onClick={() => setSelectedRowKeys([])}>Снять выбор</Button>
        </div>
      )}

      {actions.isAdding && (
        <MaterialsAddForm
          form={actions.addForm}
          materialNames={materialNames}
          selectedAddUnit={actions.selectedAddUnit}
          addItemType={actions.addItemType}
          addDeliveryType={actions.addDeliveryType}
          onItemTypeChange={actions.setAddItemType}
          onDeliveryTypeChange={actions.setAddDeliveryType}
          onMaterialNameSelect={actions.handleAddMaterialNameSelect}
          onSubmit={actions.handleAddSubmit}
          onCancel={actions.cancelAdd}
        />
      )}

      <Form form={actions.form} component={false}>
        <Table
          components={{ body: { cell: MaterialsEditableCell } }}
          rowSelection={{
            selectedRowKeys,
            onChange: keys => setSelectedRowKeys(keys),
            getCheckboxProps: (record: any) => ({
              disabled: record._type === 'folder',
              style: record._type === 'folder' ? { display: 'none' } : undefined,
            }),
          }}
          dataSource={tableData}
          columns={finalColumns}
          rowClassName={getRowClassName}
          onRow={(record: any) => ({
            onClick: () => {
              if (record._type === 'folder') {
                setActiveFolder(activeFolder === record.id ? null : record.id);
              }
            },
            style: { cursor: record._type === 'folder' ? 'pointer' : undefined },
          })}
          pagination={{
            current: currentPage,
            pageSize,
            pageSizeOptions: ['100', '250', '500', '1000'],
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
            onChange: (page, size) => { setCurrentPage(page); setPageSize(size); },
          }}
          loading={loading}
          rowKey="id"
          scroll={{ y: 560 }}
          size="small"
        />
      </Form>

      {/* Модал создания папки */}
      <Modal
        title="Создать папку"
        open={createModalOpen}
        onOk={handleCreateFolder}
        onCancel={() => setCreateModalOpen(false)}
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
        open={!!renameTarget}
        onOk={handleRenameFolder}
        onCancel={() => { setRenameTarget(null); setFolderInputValue(''); }}
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

      <style>{`
        .folder-row td { background-color: rgba(250, 173, 20, 0.08) !important; }
        .folder-row:hover > td { background-color: rgba(250, 173, 20, 0.15) !important; }
        .folder-row-active td { background-color: rgba(250, 173, 20, 0.2) !important; }
        .folder-row-active:hover > td { background-color: rgba(250, 173, 20, 0.28) !important; }
        .material-row-mat { background-color: rgba(33, 150, 243, 0.15) !important; }
        .material-row-mat:hover > td { background-color: rgba(33, 150, 243, 0.25) !important; }
        .material-row-sub-mat { background-color: rgba(156, 204, 101, 0.15) !important; }
        .material-row-sub-mat:hover > td { background-color: rgba(156, 204, 101, 0.25) !important; }
        .material-row-mat-comp { background-color: rgba(0, 137, 123, 0.15) !important; }
        .material-row-mat-comp:hover > td { background-color: rgba(0, 137, 123, 0.25) !important; }
      `}</style>
    </div>
  );
});

export default MaterialsTab;
