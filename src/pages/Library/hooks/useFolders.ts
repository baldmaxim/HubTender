import { useState, useEffect, useCallback, useMemo } from 'react';
import { message } from 'antd';
import type { LibraryFolder } from '../../../lib/supabase';
import {
  listLibraryFolders,
  createLibraryFolder,
  renameLibraryFolder,
  deleteLibraryFolder,
  moveLibraryItem,
} from '../../../lib/api/library';

export type FolderNode = LibraryFolder & { children: FolderNode[] };

const buildFolderTree = (folders: LibraryFolder[]): FolderNode[] => {
  const map = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];

  folders.forEach(f => map.set(f.id, { ...f, children: [] }));
  folders.forEach(f => {
    const node = map.get(f.id)!;
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
};

export const useFolders = (type: 'works' | 'materials' | 'templates') => {
  const [folders, setFolders] = useState<LibraryFolder[]>([]);

  const fetchFolders = useCallback(async () => {
    try {
      const data = await listLibraryFolders(type);
      setFolders((data || []) as unknown as LibraryFolder[]);
    } catch {
      message.error('Ошибка загрузки папок');
    }
  }, [type]);

  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const createFolder = async (name: string, parentId?: string | null): Promise<void> => {
    await createLibraryFolder({ name: name.trim(), type, parent_id: parentId ?? null });
    await fetchFolders();
  };

  const renameFolder = async (id: string, name: string): Promise<void> => {
    await renameLibraryFolder(id, name.trim());
    await fetchFolders();
  };

  const deleteFolder = async (id: string): Promise<void> => {
    await deleteLibraryFolder(id);
    await fetchFolders();
  };

  const moveItem = async (
    table: 'works_library' | 'materials_library' | 'templates',
    itemId: string,
    folderId: string | null
  ): Promise<void> => {
    await moveLibraryItem(table, itemId, folderId);
  };

  return { folders, folderTree, fetchFolders, createFolder, renameFolder, deleteFolder, moveItem };
};
