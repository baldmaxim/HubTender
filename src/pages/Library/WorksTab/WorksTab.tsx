import { forwardRef, useImperativeHandle, useState, useEffect } from 'react';
import { Table, Form, Button, Dropdown, message, Input, Modal, Space, Tooltip, Popconfirm } from 'antd';
import {
  FolderOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  AppstoreOutlined, FileOutlined,
} from '@ant-design/icons';
import type { LibraryFolder, WorkLibraryFull } from '../../../lib/supabase';
import { useWorksData } from './hooks/useWorksData';
import { useWorksActions } from './hooks/useWorksActions';
import { WorksAddForm } from './components/WorksAddForm';
import { getWorksTableColumns } from './components/WorksTableColumns';
import { WorksEditableCell } from './components/WorksEditableCell';
import { useFolders } from '../hooks/useFolders';

interface WorksTabProps {
  searchText: string;
}

type FolderRow = LibraryFolder & { _type: 'folder' };
type TableRow = FolderRow | WorkLibraryFull;

export type WorksTabHandle = { handleAdd: () => void };

const WorksTab = forwardRef<WorksTabHandle, WorksTabProps>((props, ref) => {
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

  const { data, loading, workNames, fetchWorks } = useWorksData();
  const actions = useWorksActions(workNames, fetchWorks);
  const { folders, createFolder, renameFolder, deleteFolder, moveItem } = useFolders('works');

  useEffect(() => {
    setSelectedRowKeys([]);
    setCurrentPage(1);
  }, [activeFolder]);

  useImperativeHandle(ref, () => ({
    handleAdd: actions.handleAdd,
  }));

  const handleBulkMove = async (folderId: string | null) => {
    setBulkLoading(true);
    try {
      await Promise.all(selectedRowKeys.map(id => moveItem('works_library', id as string, folderId)));
      fetchWorks();
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

  const getRowClassName = (record: TableRow) => {
    if ('_type' in record && record._type === 'folder') {
      return activeFolder === record.id ? 'folder-row folder-row-active' : 'folder-row';
    }
    if (actions.isEditing(record as WorkLibraryFull)) return 'editable-row';
    if ('item_type' in record) {
      switch ((record as WorkLibraryFull).item_type) {
        case 'раб': return 'work-row-rab';
        case 'суб-раб': return 'work-row-sub-rab';
        case 'раб-комп.': return 'work-row-rab-comp';
        default: return '';
      }
    }
    return '';
  };

  const baseColumns = getWorksTableColumns({
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

  type AntColumn = Record<string, unknown>;

  const mergedColumns = (baseColumns as AntColumn[]).map((col) => {
    if (!col.editable) return col;
    return {
      ...col,
      onCell: (record: TableRow) => ({
        record,
        dataIndex: col.dataIndex,
        title: col.title,
        editing: actions.isEditing(record as WorkLibraryFull),
        workNames,
        onWorkNameSelect: actions.handleWorkNameSelect,
      }),
    };
  });

  // Override columns to handle folder rows
  const finalColumns = mergedColumns.map((col) => ({
    ...col,
    onCell: (record: TableRow) => {
      if ('_type' in record && record._type === 'folder') return {};
      return typeof col.onCell === 'function' ? col.onCell(record) : {};
    },
    render: (value: unknown, record: TableRow, index: number) => {
      if ('_type' in record && record._type === 'folder') {
        if (col.dataIndex === 'work_name') {
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
      return typeof col.render === 'function' ? (col.render as (v: unknown, r: TableRow, i: number) => unknown)(value, record, index) : value;
    },
  }));

  const filteredData = data.filter(item => {
    if (!item.work_name.toLowerCase().includes(searchText.toLowerCase())) return false;
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
        <WorksAddForm
          form={actions.addForm}
          workNames={workNames}
          selectedAddUnit={actions.selectedAddUnit}
          addItemType={actions.addItemType}
          onItemTypeChange={actions.setAddItemType}
          onWorkNameSelect={actions.handleAddWorkNameSelect}
          onSubmit={actions.handleAddSubmit}
          onCancel={actions.cancelAdd}
        />
      )}

      <Form form={actions.form} component={false}>
        <Table
          components={{ body: { cell: WorksEditableCell } }}
          rowSelection={{
            selectedRowKeys,
            onChange: keys => setSelectedRowKeys(keys),
            getCheckboxProps: (record: TableRow) => ({
              disabled: '_type' in record && record._type === 'folder',
              style: '_type' in record && record._type === 'folder' ? { display: 'none' } : undefined,
            }),
          }}
          dataSource={tableData}
          columns={finalColumns}
          rowClassName={getRowClassName}
          onRow={(record: TableRow) => ({
            onClick: () => {
              if ('_type' in record && record._type === 'folder') {
                setActiveFolder(activeFolder === record.id ? null : record.id);
              }
            },
            style: { cursor: '_type' in record && record._type === 'folder' ? 'pointer' : undefined },
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
        .work-row-rab { background-color: rgba(255, 152, 0, 0.15) !important; }
        .work-row-rab:hover > td { background-color: rgba(255, 152, 0, 0.25) !important; }
        .work-row-sub-rab { background-color: rgba(156, 39, 176, 0.15) !important; }
        .work-row-sub-rab:hover > td { background-color: rgba(156, 39, 176, 0.25) !important; }
        .work-row-rab-comp { background-color: rgba(244, 67, 54, 0.15) !important; }
        .work-row-rab-comp:hover > td { background-color: rgba(244, 67, 54, 0.25) !important; }
      `}</style>
    </div>
  );
});

export default WorksTab;
