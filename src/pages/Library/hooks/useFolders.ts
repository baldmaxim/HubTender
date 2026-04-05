import { useState, useEffect, useCallback, useMemo } from 'react';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
import type { LibraryFolder } from '../../../lib/supabase';

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
    const { data, error } = await supabase
      .from('library_folders')
      .select('*')
      .eq('type', type)
      .order('sort_order')
      .order('name');
    if (error) { message.error('Ошибка загрузки папок'); return; }
    setFolders(data || []);
  }, [type]);

  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const createFolder = async (name: string, parentId?: string | null): Promise<void> => {
    const { error } = await supabase
      .from('library_folders')
      .insert({ name: name.trim(), type, parent_id: parentId ?? null });
    if (error) throw error;
    await fetchFolders();
  };

  const renameFolder = async (id: string, name: string): Promise<void> => {
    const { error } = await supabase
      .from('library_folders')
      .update({ name: name.trim() })
      .eq('id', id);
    if (error) throw error;
    await fetchFolders();
  };

  const deleteFolder = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('library_folders')
      .delete()
      .eq('id', id);
    if (error) throw error;
    await fetchFolders();
  };

  const moveItem = async (
    table: 'works_library' | 'materials_library' | 'templates',
    itemId: string,
    folderId: string | null
  ): Promise<void> => {
    const { error } = await supabase
      .from(table)
      .update({ folder_id: folderId })
      .eq('id', itemId);
    if (error) throw error;
  };

  return { folders, folderTree, fetchFolders, createFolder, renameFolder, deleteFolder, moveItem };
};
