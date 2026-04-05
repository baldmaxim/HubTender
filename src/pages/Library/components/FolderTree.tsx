import React, { useState, useEffect, useRef } from 'react';
import { Tree, Button, Modal, Input, Popconfirm, Tooltip, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  FolderOutlined, FolderOpenOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  AppstoreOutlined, FileOutlined,
} from '@ant-design/icons';
import type { FolderNode } from '../hooks/useFolders';

const { Text } = Typography;

interface FolderTreeProps {
  folderTree: FolderNode[];
  activeFolder: string | null | 'none';
  onFolderSelect: (value: string | null | 'none') => void;
  onCreateFolder: (name: string, parentId?: string | null) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
}

interface NodeTitleProps {
  folder: FolderNode;
  onAddChild: (folder: FolderNode) => void;
  onRename: (folder: FolderNode) => void;
  onDelete: (folder: FolderNode) => void;
}

const NodeTitle: React.FC<NodeTitleProps> = ({ folder, onAddChild, onRename, onDelete }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', width: '100%', minWidth: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
        {folder.name}
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.15s',
          flexShrink: 0,
          marginLeft: 4,
        }}
        onClick={e => e.stopPropagation()}
      >
        <Tooltip title="Создать подпапку" mouseEnterDelay={0.8}>
          <PlusOutlined
            style={{ fontSize: 11, cursor: 'pointer', opacity: 0.7 }}
            onClick={() => onAddChild(folder)}
          />
        </Tooltip>
        <Tooltip title="Переименовать" mouseEnterDelay={0.8}>
          <EditOutlined
            style={{ fontSize: 11, cursor: 'pointer', opacity: 0.7 }}
            onClick={() => onRename(folder)}
          />
        </Tooltip>
        <Popconfirm
          title={`Удалить папку «${folder.name}»?`}
          description={
            <Text type="secondary" style={{ fontSize: 12 }}>
              Дочерние папки станут корневыми, элементы — без папки
            </Text>
          }
          onConfirm={() => onDelete(folder)}
          okText="Удалить"
          okType="danger"
          cancelText="Отмена"
        >
          <Tooltip title="Удалить" mouseEnterDelay={0.8}>
            <DeleteOutlined style={{ fontSize: 11, cursor: 'pointer', opacity: 0.7 }} />
          </Tooltip>
        </Popconfirm>
      </span>
    </span>
  );
};

const getAllKeys = (nodes: FolderNode[]): string[] => [
  ...nodes.map(n => n.id),
  ...nodes.flatMap(n => getAllKeys(n.children)),
];

const convertToDataNodes = (nodes: FolderNode[]): DataNode[] =>
  nodes.map(node => ({
    key: node.id,
    title: node.name,
    isLeaf: node.children.length === 0,
    children: convertToDataNodes(node.children),
    folderData: node,
  } as DataNode & { folderData: FolderNode }));

export const FolderTree: React.FC<FolderTreeProps> = ({
  folderTree,
  activeFolder,
  onFolderSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}) => {
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<FolderNode | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const initializedRef = useRef(false);

  // Раскрыть все папки при первой загрузке
  useEffect(() => {
    if (!initializedRef.current && folderTree.length > 0) {
      initializedRef.current = true;
      setExpandedKeys(getAllKeys(folderTree));
    }
  }, [folderTree]);

  const handleOpenCreateRoot = () => {
    setCreateParentId(null);
    setInputValue('');
    setCreateModalOpen(true);
  };

  const handleOpenCreateChild = (folder: FolderNode) => {
    setCreateParentId(folder.id);
    setInputValue('');
    setCreateModalOpen(true);
  };

  const handleOpenRename = (folder: FolderNode) => {
    setRenameTarget(folder);
    setInputValue(folder.name);
    setRenameModalOpen(true);
  };

  const handleDelete = async (folder: FolderNode) => {
    await onDeleteFolder(folder.id);
    if (activeFolder === folder.id) onFolderSelect(null);
  };

  const handleCreate = async () => {
    if (!inputValue.trim()) return;
    setSaving(true);
    try {
      await onCreateFolder(inputValue.trim(), createParentId);
      if (createParentId && !expandedKeys.includes(createParentId)) {
        setExpandedKeys(prev => [...prev, createParentId!]);
      }
      setCreateModalOpen(false);
      setInputValue('');
    } catch {
      // error handled in hook
    } finally {
      setSaving(false);
    }
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

  const treeData: DataNode[] = [
    { key: '__all__', title: 'Все', isLeaf: true },
    { key: '__none__', title: 'Без папки', isLeaf: true },
    ...convertToDataNodes(folderTree),
  ];

  const selectedKeys: React.Key[] =
    activeFolder === null ? ['__all__'] :
    activeFolder === 'none' ? ['__none__'] :
    [activeFolder];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Tree
        treeData={treeData}
        selectedKeys={selectedKeys}
        expandedKeys={expandedKeys}
        onExpand={keys => setExpandedKeys(keys)}
        onSelect={keys => {
          const key = keys.length === 0 ? '__all__' : keys[0];
          if (key === '__all__') onFolderSelect(null);
          else if (key === '__none__') onFolderSelect('none');
          else onFolderSelect(key as string);
        }}
        titleRender={(nodeData: any) => {
          if (nodeData.key === '__all__') {
            return <span style={{ fontSize: 13 }}><AppstoreOutlined style={{ marginRight: 6, opacity: 0.7 }} />Все</span>;
          }
          if (nodeData.key === '__none__') {
            return <span style={{ fontSize: 13 }}><FileOutlined style={{ marginRight: 6, opacity: 0.7 }} />Без папки</span>;
          }
          const folder = nodeData.folderData as FolderNode;
          return (
            <NodeTitle
              folder={folder}
              onAddChild={handleOpenCreateChild}
              onRename={handleOpenRename}
              onDelete={handleDelete}
            />
          );
        }}
        icon={(props: any) => {
          if (props.data?.key === '__all__' || props.data?.key === '__none__') return null;
          return props.expanded ? <FolderOpenOutlined style={{ fontSize: 13 }} /> : <FolderOutlined style={{ fontSize: 13 }} />;
        }}
        showIcon
        blockNode
        style={{ userSelect: 'none' }}
      />

      <Button size="small" icon={<PlusOutlined />} onClick={handleOpenCreateRoot} block>
        Создать папку
      </Button>

      <Modal
        title={createParentId ? 'Создать подпапку' : 'Создать папку'}
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
    </div>
  );
};
