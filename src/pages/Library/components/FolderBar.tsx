import React, { useState } from 'react';
import { Button, Space, Tag, Modal, Input, Tooltip, Popconfirm, Typography } from 'antd';
import { FolderOutlined, PlusOutlined, EditOutlined, DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons';
import type { LibraryFolder } from '../../../lib/supabase';

const { Text } = Typography;

interface FolderBarProps {
  folders: LibraryFolder[];
  activeFolder: string | null | 'none'; // null = все, 'none' = без папки, string = folder.id
  onFolderSelect: (value: string | null | 'none') => void;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
}

export const FolderBar: React.FC<FolderBarProps> = ({
  folders,
  activeFolder,
  onFolderSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}) => {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<LibraryFolder | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!inputValue.trim()) return;
    setSaving(true);
    try {
      await onCreateFolder(inputValue.trim());
      setCreateModalOpen(false);
      setInputValue('');
    } catch {
      // error handled in hook
    } finally {
      setSaving(false);
    }
  };

  const openRename = (folder: LibraryFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameTarget(folder);
    setInputValue(folder.name);
    setRenameModalOpen(true);
  };

  const handleRename = async () => {
    if (!renameTarget || !inputValue.trim()) return;
    setSaving(true);
    try {
      await onRenameFolder(renameTarget.id, inputValue.trim());
      setRenameModalOpen(false);
      setRenameTarget(null);
      setInputValue('');
    } catch {
      // error handled in hook
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {/* Кнопка "Все" */}
        <Tag
          style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 13, userSelect: 'none' }}
          color={activeFolder === null ? 'green' : 'default'}
          onClick={() => onFolderSelect(null)}
        >
          Все
        </Tag>

        {/* Кнопка "Без папки" */}
        <Tag
          style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 13, userSelect: 'none' }}
          color={activeFolder === 'none' ? 'orange' : 'default'}
          onClick={() => onFolderSelect('none')}
        >
          Без папки
        </Tag>

        {/* Папки */}
        {folders.map(folder => (
          <Tag
            key={folder.id}
            icon={activeFolder === folder.id ? <FolderOpenOutlined /> : <FolderOutlined />}
            color={activeFolder === folder.id ? 'blue' : 'default'}
            style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 13, userSelect: 'none' }}
            onClick={() => onFolderSelect(folder.id)}
          >
            {folder.name}
            <span style={{ marginLeft: 6 }} onClick={e => e.stopPropagation()}>
              <Tooltip title="Переименовать">
                <EditOutlined
                  style={{ fontSize: 11, opacity: 0.6, marginRight: 4 }}
                  onClick={(e) => openRename(folder, e)}
                />
              </Tooltip>
              <Popconfirm
                title={`Удалить папку «${folder.name}»?`}
                description={<Text type="secondary">Строки будут перемещены в «Без папки»</Text>}
                onConfirm={async () => { await onDeleteFolder(folder.id); if (activeFolder === folder.id) onFolderSelect(null); }}
                okText="Удалить"
                okType="danger"
                cancelText="Отмена"
                onPopupClick={e => e.stopPropagation()}
              >
                <DeleteOutlined style={{ fontSize: 11, opacity: 0.6 }} onClick={e => e.stopPropagation()} />
              </Popconfirm>
            </span>
          </Tag>
        ))}

        {/* Создать папку */}
        <Tooltip title="Создать папку">
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => { setInputValue(''); setCreateModalOpen(true); }}
          >
            Папка
          </Button>
        </Tooltip>
      </div>

      {/* Модал создания */}
      <Modal
        title="Создать папку"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => setCreateModalOpen(false)}
        okText="Создать"
        cancelText="Отмена"
        confirmLoading={saving}
        destroyOnClose
      >
        <Input
          placeholder="Название папки"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onPressEnter={handleCreate}
          autoFocus
          maxLength={100}
        />
      </Modal>

      {/* Модал переименования */}
      <Modal
        title="Переименовать папку"
        open={renameModalOpen}
        onOk={handleRename}
        onCancel={() => setRenameModalOpen(false)}
        okText="Сохранить"
        cancelText="Отмена"
        confirmLoading={saving}
        destroyOnClose
      >
        <Input
          placeholder="Новое название"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onPressEnter={handleRename}
          autoFocus
          maxLength={100}
        />
      </Modal>
    </>
  );
};
