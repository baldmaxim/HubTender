// Cost categories + detail cost categories + units (full row).
// Currently Supabase-only — no Go BFF write endpoints exist for these tables.
// (The references domain has READ-only endpoints in src/lib/api/hooks/useApiReferences.ts.)

import { supabase } from '../supabase';
import type { Tables } from '../supabase/database.types';

export type CostCategoryRow = Tables<'cost_categories'>;
export type DetailCostCategoryRow = Tables<'detail_cost_categories'>;
export type UnitRow = Tables<'units'>;

export interface DetailCostCategoryWithJoinedCategory extends DetailCostCategoryRow {
  cost_categories: CostCategoryRow | null;
}

// ─── Loading ────────────────────────────────────────────────────────────────

export async function listCostCategories(): Promise<CostCategoryRow[]> {
  const { data, error } = await supabase.from('cost_categories').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listAllDetailCostCategoriesByOrder(): Promise<DetailCostCategoryRow[]> {
  const { data, error } = await supabase
    .from('detail_cost_categories')
    .select('*')
    .order('order_num', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listCostCategoriesByIds(ids: string[]): Promise<CostCategoryRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('cost_categories').select('*').in('id', ids);
  if (error) throw error;
  return data ?? [];
}

export interface LocationRow {
  id: string;
  name?: string | null;
}

export async function listLocationsByIds(ids: string[]): Promise<LocationRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('locations').select('*').in('id', ids);
  if (error) throw error;
  return (data ?? []) as LocationRow[];
}

export async function listDetailCostCategoriesWithCategory(): Promise<DetailCostCategoryWithJoinedCategory[]> {
  const { data, error } = await supabase
    .from('detail_cost_categories')
    .select('*, cost_categories(*)')
    .order('order_num');
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as DetailCostCategoryRow & {
      cost_categories: CostCategoryRow | CostCategoryRow[] | null;
    };
    const cat = Array.isArray(r.cost_categories) ? r.cost_categories[0] ?? null : r.cost_categories;
    return { ...r, cost_categories: cat } as DetailCostCategoryWithJoinedCategory;
  });
}

export async function listActiveUnitsFull(): Promise<UnitRow[]> {
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

// ─── Cost categories ────────────────────────────────────────────────────────

export async function createCostCategory(input: { name: string; unit?: string }): Promise<CostCategoryRow> {
  const { data, error } = await supabase
    .from('cost_categories')
    .insert({ name: input.name, unit: input.unit })
    .select()
    .single();
  if (error) throw error;
  return data as CostCategoryRow;
}

export async function updateCostCategory(
  id: string,
  patch: { name?: string; unit?: string },
): Promise<void> {
  const { error } = await supabase.from('cost_categories').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteCostCategory(id: string): Promise<void> {
  const { error } = await supabase.from('cost_categories').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteAllCostCategories(): Promise<void> {
  const { error } = await supabase.from('cost_categories').delete().not('id', 'is', null);
  if (error) throw error;
}

export async function findCostCategoryByNameAndUnit(name: string, unit: string): Promise<CostCategoryRow | null> {
  const { data, error } = await supabase
    .from('cost_categories')
    .select('*')
    .eq('name', name)
    .eq('unit', unit)
    .maybeSingle();
  if (error) throw error;
  return (data as CostCategoryRow) ?? null;
}

// ─── Detail cost categories ────────────────────────────────────────────────

export async function getMaxDetailCostCategoryOrderNum(): Promise<number> {
  const { data, error } = await supabase
    .from('detail_cost_categories')
    .select('order_num')
    .order('order_num', { ascending: false })
    .limit(1);
  if (error) throw error;
  const max = data?.[0]?.order_num;
  return typeof max === 'number' ? max : 0;
}

export interface DetailCostCategoryInput {
  cost_category_id?: string;
  name?: string;
  unit?: string;
  location?: string;
  order_num?: number;
}

export async function createDetailCostCategory(input: DetailCostCategoryInput): Promise<void> {
  const { error } = await supabase.from('detail_cost_categories').insert({
    cost_category_id: input.cost_category_id,
    name: input.name,
    unit: input.unit,
    location: input.location,
    order_num: input.order_num,
  });
  if (error) throw error;
}

export async function updateDetailCostCategory(
  id: string,
  patch: { name?: string; unit?: string; location?: string },
): Promise<void> {
  const { error } = await supabase.from('detail_cost_categories').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteDetailCostCategory(id: string): Promise<void> {
  const { error } = await supabase.from('detail_cost_categories').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteAllDetailCostCategories(): Promise<void> {
  const { error } = await supabase.from('detail_cost_categories').delete().not('id', 'is', null);
  if (error) throw error;
}

// ─── Units (used by ImportExcel during cost-category import) ───────────────

export interface ImportedUnit {
  code: string;
  name: string;
  name_short: string;
  category: string;
  sort_order: number;
  is_active: boolean;
}

export async function upsertImportedUnits(units: ImportedUnit[]): Promise<void> {
  if (units.length === 0) return;
  const { error } = await supabase.from('units').upsert(units, { onConflict: 'code' });
  if (error) throw error;
}
