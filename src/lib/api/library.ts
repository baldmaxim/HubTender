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
  const res = await apiFetch<{ data: WorkLibraryRow[] }>('/api/v1/library/works', {
    cacheKey: 'library:works',
  });
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
  const res = await apiFetch<{ data: MaterialLibraryRow[] }>('/api/v1/library/materials', {
    cacheKey: 'library:materials',
  });
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

// ─── templates / template_items ─────────────────────────────────────────────

export interface TemplateApiRow {
  id: string;
  name: string;
  detail_cost_category_id: string | null;
  folder_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  detail_cost_categories:
    | { name: string; location: string | null; cost_categories: { name: string } | null }
    | null;
}

export async function listTemplates(): Promise<TemplateApiRow[]> {
  const res = await apiFetch<{ data: TemplateApiRow[] }>('/api/v1/library/templates', {
    cacheKey: 'library:templates',
  });
  return res.data ?? [];
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function listTemplateItems(templateId: string): Promise<unknown[]> {
  const res = await apiFetch<{ data: unknown[] }>(
    `/api/v1/library/templates/${encodeURIComponent(templateId)}/items`,
  );
  return res.data ?? [];
}

export async function deleteTemplateItem(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/template-items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export interface CreateTemplateWork {
  work_library_id: string | null;
  detail_cost_category_id: string | null;
  note: string | null;
}
export interface CreateTemplateMaterial {
  material_library_id: string | null;
  parent_work_index: number | null;
  conversation_coeff: number | null;
  detail_cost_category_id: string | null;
  note: string | null;
}
export interface CreateTemplatePayload {
  name: string;
  detail_cost_category_id: string;
  works: CreateTemplateWork[];
  materials: CreateTemplateMaterial[];
}

export async function createTemplate(payload: CreateTemplatePayload): Promise<string> {
  const res = await apiFetch<{ data: { id: string } }>('/api/v1/library/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data.id;
}

export interface UpdateTemplateItemPatch {
  id: string;
  parent_work_item_id: string | null;
  conversation_coeff: number | null;
  detail_cost_category_id: string | null;
}
export interface UpdateTemplatePayload {
  name: string;
  detail_cost_category_id: string;
  items: UpdateTemplateItemPatch[];
}

export async function updateTemplate(id: string, payload: UpdateTemplatePayload): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/templates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function addTemplateItem(
  templateId: string,
  input: {
    kind: 'work' | 'material';
    work_library_id: string | null;
    material_library_id: string | null;
    position: number;
  },
): Promise<Record<string, unknown>> {
  const res = await apiFetch<{ data: Record<string, unknown> }>(
    `/api/v1/library/templates/${encodeURIComponent(templateId)}/items`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return res.data;
}
