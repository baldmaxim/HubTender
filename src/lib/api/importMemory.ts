// Этап 2.3: управление персональной памятью умного импорта (§10).
// Все операции user-scoped на backend: user_id берётся ТОЛЬКО из JWT,
// frontend его не передаёт (§15).
import { apiFetch } from './client';

export interface MappingProfileRow {
  id: string;
  name: string;
  status: 'usable' | 'requires_review' | 'inactive' | string;
  use_count: number;
  last_used_at?: string;
  created_at?: string;
  sheet_name_hint?: string;
  header_row_hint?: number;
  mapped_fields?: string[];
}

export interface NomenclatureAliasRow {
  id: string;
  catalog_kind: 'material' | 'work' | string;
  catalog_id: string;
  catalog_label: string;
  catalog_unit: string;
  normalized_source_text: string;
  canonical_boq_item_type: string;
  normalized_unit_code?: string;
  is_active: boolean;
  use_count: number;
  last_used_at?: string;
  created_at: string;
}

interface ListQuery {
  search?: string;
  active?: boolean;
  page?: number;
  page_size?: number;
}

function qs(q: ListQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.active) p.set('active', 'true');
  if (q.page) p.set('page', String(q.page));
  if (q.page_size) p.set('page_size', String(q.page_size));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listMappingProfiles(q: ListQuery = {}): Promise<{ items: MappingProfileRow[]; total: number }> {
  const res = await apiFetch<{ data: { items: MappingProfileRow[] | null; total: number } }>(
    `/api/v1/boq-import/mapping-profiles${qs(q)}`, { method: 'GET' });
  return { items: res.data.items ?? [], total: res.data.total };
}

export async function patchMappingProfile(id: string, patch: { name?: string; is_active?: boolean }): Promise<void> {
  await apiFetch(`/api/v1/boq-import/mapping-profiles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deactivateMappingProfile(id: string): Promise<void> {
  await apiFetch(`/api/v1/boq-import/mapping-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listNomenclatureAliases(q: ListQuery = {}): Promise<{ items: NomenclatureAliasRow[]; total: number }> {
  const res = await apiFetch<{ data: { items: NomenclatureAliasRow[] | null; total: number } }>(
    `/api/v1/boq-import/nomenclature-aliases${qs(q)}`, { method: 'GET' });
  return { items: res.data.items ?? [], total: res.data.total };
}

export async function deactivateNomenclatureAlias(id: string): Promise<void> {
  await apiFetch(`/api/v1/boq-import/nomenclature-aliases/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
