// Library page helpers (works_library / materials_library / templates /
// library_folders) — Go BFF only. Added incrementally per tab.

import type { Tables } from '../supabase/database.types';
import { apiFetch } from './client';

export interface LibraryNameEmbed {
  id: string;
  name: string;
  unit: string;
}

// ─── works_library ──────────────────────────────────────────────────────────

export type WorkLibraryRow = Tables<'works_library'> & {
  work_names: LibraryNameEmbed | null;
};

export interface WorkLibraryInput {
  work_name_id: string;
  item_type: string;
  unit_rate: number;
  currency_type: string;
}

/** works_library + work_names embed, newest first. */
export async function listWorksLibrary(): Promise<WorkLibraryRow[]> {
  const res = await apiFetch<{ data: WorkLibraryRow[] }>('/api/v1/library/works');
  return res.data ?? [];
}

export async function createWorkLibrary(input: WorkLibraryInput): Promise<void> {
  await apiFetch<undefined>('/api/v1/library/works', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateWorkLibrary(id: string, input: WorkLibraryInput): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/works/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteWorkLibrary(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/works/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── materials_library ──────────────────────────────────────────────────────

export type MaterialLibraryRow = Tables<'materials_library'> & {
  material_names: LibraryNameEmbed | null;
};

export interface MaterialLibraryInput {
  material_name_id: string;
  material_type: string;
  item_type: string;
  consumption_coefficient: number;
  unit_rate: number;
  currency_type: string;
  delivery_price_type: string;
  delivery_amount: number;
}

/** materials_library + material_names embed, newest first. */
export async function listMaterialsLibrary(): Promise<MaterialLibraryRow[]> {
  const res = await apiFetch<{ data: MaterialLibraryRow[] }>('/api/v1/library/materials');
  return res.data ?? [];
}

export async function createMaterialLibrary(input: MaterialLibraryInput): Promise<void> {
  await apiFetch<undefined>('/api/v1/library/materials', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateMaterialLibrary(id: string, input: MaterialLibraryInput): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/materials/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteMaterialLibrary(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/materials/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── library_folders ────────────────────────────────────────────────────────

export type LibraryFolderRow = Tables<'library_folders'>;

export async function listLibraryFolders(
  type: 'works' | 'materials' | 'templates',
): Promise<LibraryFolderRow[]> {
  const res = await apiFetch<{ data: LibraryFolderRow[] }>(
    `/api/v1/library/folders?type=${encodeURIComponent(type)}`,
  );
  return res.data ?? [];
}

export async function createLibraryFolder(input: {
  name: string;
  type: string;
  parent_id: string | null;
}): Promise<void> {
  await apiFetch<undefined>('/api/v1/library/folders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function renameLibraryFolder(id: string, name: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/folders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteLibraryFolder(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/folders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function moveLibraryItem(
  table: 'works_library' | 'materials_library' | 'templates',
  itemId: string,
  folderId: string | null,
): Promise<void> {
  await apiFetch<undefined>('/api/v1/library/move', {
    method: 'POST',
    body: JSON.stringify({ table, item_id: itemId, folder_id: folderId }),
  });
}
