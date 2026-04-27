// CRUD helpers for the Nomenclatures admin pages: units, material_names,
// work_names. Materials/works _library remap helpers are also exported so the
// "delete duplicates" flow in useMaterials / useWorks can compose them.
//
// Currently routes through Supabase only — Go BFF has READ-only references
// endpoints (see src/lib/api/hooks/useApiReferences.ts). Once write endpoints
// land we add an `if (isGoEnabled('references'))` branch per function.

import { supabase } from '../supabase';
import type { Database } from '../supabase/database.types';

type UnitRow = Database['public']['Tables']['units']['Row'];
type MaterialNameRow = Database['public']['Tables']['material_names']['Row'];
type WorkNameRow = Database['public']['Tables']['work_names']['Row'];

const PAGE_SIZE = 1000;

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
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listActiveUnits(): Promise<Array<Pick<UnitRow, 'code' | 'name'>>> {
  const { data, error } = await supabase
    .from('units')
    .select('code, name')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function unitExists(code: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('units')
    .select('code')
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function createUnit(input: UnitInput): Promise<void> {
  const { error } = await supabase.from('units').insert({
    code: input.code,
    name: input.name,
    category: input.category,
    description: input.description,
    sort_order: input.sort_order,
    is_active: input.is_active,
  });
  if (error) throw error;
}

export async function updateUnit(code: string, input: UnitInput): Promise<void> {
  const { error } = await supabase
    .from('units')
    .update({
      name: input.name,
      category: input.category,
      sort_order: input.sort_order,
      is_active: input.is_active,
    })
    .eq('code', code);
  if (error) throw error;
}

export async function deleteUnit(code: string): Promise<void> {
  const { error } = await supabase.from('units').delete().eq('code', code);
  if (error) throw error;
}

// ─── Material names ─────────────────────────────────────────────────────────

export interface MaterialNameInput {
  name: string;
  unit: string;
}

async function listAllPaginated<T>(table: 'material_names' | 'work_names'): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export function listMaterialNames(): Promise<MaterialNameRow[]> {
  return listAllPaginated<MaterialNameRow>('material_names');
}

export async function listMaterialNamesByUnit(
  unit: string,
): Promise<Array<Pick<MaterialNameRow, 'name' | 'unit'>>> {
  const { data, error } = await supabase
    .from('material_names')
    .select('name, unit')
    .eq('unit', unit);
  if (error) throw error;
  return data ?? [];
}

export async function createMaterialName(input: MaterialNameInput): Promise<void> {
  const { error } = await supabase.from('material_names').insert([{
    name: input.name,
    unit: input.unit,
  }]);
  if (error) throw error;
}

export async function updateMaterialName(id: string, input: MaterialNameInput): Promise<void> {
  const { error } = await supabase
    .from('material_names')
    .update({ name: input.name, unit: input.unit })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteMaterialName(id: string): Promise<void> {
  const { error } = await supabase.from('material_names').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteMaterialNamesIn(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('material_names').delete().in('id', ids);
  if (error) throw error;
}

export async function remapBoqMaterialName(from: string, to: string): Promise<void> {
  const { error } = await supabase
    .from('boq_items')
    .update({ material_name_id: to })
    .eq('material_name_id', from);
  if (error) throw error;
}

export async function remapMaterialsLibraryMaterialName(from: string, to: string): Promise<void> {
  const { error } = await supabase
    .from('materials_library')
    .update({ material_name_id: to })
    .eq('material_name_id', from);
  if (error) throw error;
}

// ─── Work names ─────────────────────────────────────────────────────────────

export interface WorkNameInput {
  name: string;
  unit: string;
}

export function listWorkNames(): Promise<WorkNameRow[]> {
  return listAllPaginated<WorkNameRow>('work_names');
}

export async function listWorkNamesByUnit(
  unit: string,
): Promise<Array<Pick<WorkNameRow, 'name' | 'unit'>>> {
  const { data, error } = await supabase
    .from('work_names')
    .select('name, unit')
    .eq('unit', unit);
  if (error) throw error;
  return data ?? [];
}

export async function createWorkName(input: WorkNameInput): Promise<void> {
  const { error } = await supabase.from('work_names').insert([{
    name: input.name,
    unit: input.unit,
  }]);
  if (error) throw error;
}

export async function updateWorkName(id: string, input: WorkNameInput): Promise<void> {
  const { error } = await supabase
    .from('work_names')
    .update({ name: input.name, unit: input.unit })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteWorkName(id: string): Promise<void> {
  const { error } = await supabase.from('work_names').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteWorkNamesIn(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('work_names').delete().in('id', ids);
  if (error) throw error;
}

export async function remapBoqWorkName(from: string, to: string): Promise<void> {
  const { error } = await supabase
    .from('boq_items')
    .update({ work_name_id: to })
    .eq('work_name_id', from);
  if (error) throw error;
}

export async function remapWorksLibraryWorkName(from: string, to: string): Promise<void> {
  const { error } = await supabase
    .from('works_library')
    .update({ work_name_id: to })
    .eq('work_name_id', from);
  if (error) throw error;
}
