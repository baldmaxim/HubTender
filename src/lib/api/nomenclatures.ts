// CRUD helpers for the Nomenclatures admin pages — Go BFF only.

import type { Database } from '../supabase/database.types';
import { apiFetch } from './client';

type UnitRow = Database['public']['Tables']['units']['Row'];
type MaterialNameRow = Database['public']['Tables']['material_names']['Row'];
type WorkNameRow = Database['public']['Tables']['work_names']['Row'];

// ─── Units ──────────────────────────────────────────────────────────────────

export interface UnitInput {
  code?: string;
  name: string;
  category?: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export async function listUnits(): Promise<UnitRow[]> {
  const res = await apiFetch<{ data: UnitRow[] }>('/api/v1/nomenclatures/units', {
    cacheKey: 'nomenclatures:units',
  });
  return res.data ?? [];
}

export async function listActiveUnits(): Promise<Array<Pick<UnitRow, 'code' | 'name'>>> {
  const res = await apiFetch<{ data: Array<Pick<UnitRow, 'code' | 'name'>> }>(
    '/api/v1/nomenclatures/units/active-list',
    { cacheKey: 'nomenclatures:units:active' },
  );
  return res.data ?? [];
}

export async function unitExists(code: string): Promise<boolean> {
  const res = await apiFetch<{ exists: boolean }>(
    `/api/v1/nomenclatures/units/exists?code=${encodeURIComponent(code)}`,
  );
  return Boolean(res.exists);
}

export async function createUnit(input: UnitInput): Promise<void> {
  await apiFetch<undefined>('/api/v1/nomenclatures/units', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateUnit(code: string, input: UnitInput): Promise<void> {
  await apiFetch<undefined>(`/api/v1/nomenclatures/units/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteUnit(code: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/nomenclatures/units/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  });
}

// ─── Material names ─────────────────────────────────────────────────────────

export interface MaterialNameInput {
  name: string;
  unit: string;
}

export async function listMaterialNames(): Promise<MaterialNameRow[]> {
  const res = await apiFetch<{ data: MaterialNameRow[] }>(
    '/api/v1/nomenclatures/material-names',
    { cacheKey: 'nomenclatures:material-names' },
  );
  return res.data ?? [];
}

export async function listMaterialNamesByUnit(
  unit: string,
): Promise<Array<Pick<MaterialNameRow, 'name' | 'unit'>>> {
  const res = await apiFetch<{ data: Array<Pick<MaterialNameRow, 'name' | 'unit'>> }>(
    `/api/v1/nomenclatures/material-names/by-unit?unit=${encodeURIComponent(unit)}`,
  );
  return res.data ?? [];
}

export async function createMaterialName(input: MaterialNameInput): Promise<void> {
  await apiFetch<undefined>('/api/v1/nomenclatures/material-names', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateMaterialName(id: string, input: MaterialNameInput): Promise<void> {
  await apiFetch<undefined>(`/api/v1/nomenclatures/material-names/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteMaterialName(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/nomenclatures/material-names/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function deleteMaterialNamesIn(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await apiFetch<undefined>('/api/v1/nomenclatures/material-names/delete-batch', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function remapBoqMaterialName(from: string, to: string): Promise<void> {
  await apiFetch<undefined>('/api/v1/nomenclatures/remap/boq-material', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });
}

export async function remapMaterialsLibraryMaterialName(from: string, to: string): Promise<void> {
  await apiFetch<undefined>('/api/v1/nomenclatures/remap/library-material', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });
}

// ─── Work names ─────────────────────────────────────────────────────────────

export interface WorkNameInput {
  name: string;
  unit: string;
}

export async function listWorkNames(): Promise<WorkNameRow[]> {
  const res = await apiFetch<{ data: WorkNameRow[] }>(
    '/api/v1/nomenclatures/work-names',
    { cacheKey: 'nomenclatures:work-names' },
  );
  return res.data ?? [];
}

export async function listWorkNamesByUnit(
  unit: string,
): Promise<Array<Pick<WorkNameRow, 'name' | 'unit'>>> {
  const res = await apiFetch<{ data: Array<Pick<WorkNameRow, 'name' | 'unit'>> }>(
    `/api/v1/nomenclatures/work-names/by-unit?unit=${encodeURIComponent(unit)}`,
  );
  return res.data ?? [];
}

export async function createWorkName(input: WorkNameInput): Promise<void> {
  await apiFetch<undefined>('/api/v1/nomenclatures/work-names', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateWorkName(id: string, input: WorkNameInput): Promise<void> {
  await apiFetch<undefined>(`/api/v1/nomenclatures/work-names/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteWorkName(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/nomenclatures/work-names/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function deleteWorkNamesIn(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await apiFetch<undefined>('/api/v1/nomenclatures/work-names/delete-batch', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function remapBoqWorkName(from: string, to: string): Promise<void> {
  await apiFetch<undefined>('/api/v1/nomenclatures/remap/boq-work', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });
}

export async function remapWorksLibraryWorkName(from: string, to: string): Promise<void> {
  await apiFetch<undefined>('/api/v1/nomenclatures/remap/library-work', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });
}
