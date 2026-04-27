// Cost categories + detail cost categories + units (full row) with Go BFF /
// Supabase fallback.

import { supabase } from '../supabase';
import type { Tables } from '../supabase/database.types';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

export type CostCategoryRow = Tables<'cost_categories'>;
export type DetailCostCategoryRow = Tables<'detail_cost_categories'>;
export type UnitRow = Tables<'units'>;

export interface DetailCostCategoryWithJoinedCategory extends DetailCostCategoryRow {
  cost_categories: CostCategoryRow | null;
}

// ─── Loading ────────────────────────────────────────────────────────────────

export async function listCostCategories(): Promise<CostCategoryRow[]> {
  if (isGoEnabled('costs')) {
    const res = await apiFetch<{ data: CostCategoryRow[] }>('/api/v1/cost-categories', {
      cacheKey: 'cost-categories:all',
    });
    return res.data ?? [];
  }
  const { data, error } = await supabase.from('cost_categories').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listAllDetailCostCategoriesByOrder(): Promise<DetailCostCategoryRow[]> {
  if (isGoEnabled('costs')) {
    const res = await apiFetch<{ data: DetailCostCategoryRow[] }>('/api/v1/detail-cost-categories', {
      cacheKey: 'detail-cost-categories:by-order',
    });
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('detail_cost_categories')
    .select('*')
    .order('order_num', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listCostCategoriesByIds(ids: string[]): Promise<CostCategoryRow[]> {
  if (ids.length === 0) return [];
  if (isGoEnabled('costs')) {
    const qs = encodeURIComponent(ids.join(','));
    const res = await apiFetch<{ data: CostCategoryRow[] }>(`/api/v1/cost-categories?ids=${qs}`);
    return res.data ?? [];
  }
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
  if (isGoEnabled('costs')) {
    const qs = encodeURIComponent(ids.join(','));
    const res = await apiFetch<{ data: LocationRow[] }>(`/api/v1/locations?ids=${qs}`);
    return res.data ?? [];
  }
  const { data, error } = await supabase.from('locations').select('*').in('id', ids);
  if (error) throw error;
  return (data ?? []) as LocationRow[];
}

export async function listDetailCostCategoriesWithCategory(): Promise<DetailCostCategoryWithJoinedCategory[]> {
  if (isGoEnabled('costs')) {
    // Go path serves the two collections separately — assemble client-side.
    const [details, cats] = await Promise.all([
      listAllDetailCostCategoriesByOrder(),
      listCostCategories(),
    ]);
    const byID = new Map(cats.map((c) => [c.id, c]));
    return details.map((d) => ({
      ...d,
      cost_categories: byID.get(d.cost_category_id) ?? null,
    })) as DetailCostCategoryWithJoinedCategory[];
  }
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
  if (isGoEnabled('costs')) {
    const res = await apiFetch<{ data: UnitRow[] }>('/api/v1/units/active', {
      cacheKey: 'units:active',
    });
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

// ─── Cost categories writes ────────────────────────────────────────────────

export async function createCostCategory(input: { name: string; unit?: string }): Promise<CostCategoryRow> {
  if (isGoEnabled('costs')) {
    const res = await apiFetch<{ data: CostCategoryRow }>('/api/v1/cost-categories', {
      method: 'POST',
      body: JSON.stringify({ name: input.name, unit: input.unit ?? null }),
    });
    return res.data;
  }
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
  if (isGoEnabled('costs')) {
    await apiFetch<undefined>(`/api/v1/cost-categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: patch.name ?? '', unit: patch.unit ?? null }),
    });
    return;
  }
  const { error } = await supabase.from('cost_categories').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteCostCategory(id: string): Promise<void> {
  if (isGoEnabled('costs')) {
    await apiFetch<undefined>(`/api/v1/cost-categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return;
  }
  const { error } = await supabase.from('cost_categories').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteAllCostCategories(): Promise<void> {
  if (isGoEnabled('costs')) {
    await apiFetch<undefined>('/api/v1/cost-categories', { method: 'DELETE' });
    return;
  }
  const { error } = await supabase.from('cost_categories').delete().not('id', 'is', null);
  if (error) throw error;
}

export async function findCostCategoryByNameAndUnit(name: string, unit: string): Promise<CostCategoryRow | null> {
  if (isGoEnabled('costs')) {
    const qs = `name=${encodeURIComponent(name)}&unit=${encodeURIComponent(unit)}`;
    const res = await apiFetch<{ data: CostCategoryRow | null }>(
      `/api/v1/cost-categories/find?${qs}`,
    );
    return res.data ?? null;
  }
  const { data, error } = await supabase
    .from('cost_categories')
    .select('*')
    .eq('name', name)
    .eq('unit', unit)
    .maybeSingle();
  if (error) throw error;
  return (data as CostCategoryRow) ?? null;
}

// ─── Detail cost categories writes ─────────────────────────────────────────

export async function getMaxDetailCostCategoryOrderNum(): Promise<number> {
  if (isGoEnabled('costs')) {
    const res = await apiFetch<{ max_order_num: number }>(
      '/api/v1/detail-cost-categories/max-order-num',
    );
    return res.max_order_num ?? 0;
  }
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
  if (isGoEnabled('costs')) {
    await apiFetch<undefined>('/api/v1/detail-cost-categories', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return;
  }
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
  if (isGoEnabled('costs')) {
    await apiFetch<undefined>(`/api/v1/detail-cost-categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return;
  }
  const { error } = await supabase.from('detail_cost_categories').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteDetailCostCategory(id: string): Promise<void> {
  if (isGoEnabled('costs')) {
    await apiFetch<undefined>(`/api/v1/detail-cost-categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return;
  }
  const { error } = await supabase.from('detail_cost_categories').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteAllDetailCostCategories(): Promise<void> {
  if (isGoEnabled('costs')) {
    await apiFetch<undefined>('/api/v1/detail-cost-categories', { method: 'DELETE' });
    return;
  }
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
  if (isGoEnabled('costs')) {
    await apiFetch<undefined>('/api/v1/units/import-batch', {
      method: 'POST',
      body: JSON.stringify({ units }),
    });
    return;
  }
  const { error } = await supabase.from('units').upsert(units, { onConflict: 'code' });
  if (error) throw error;
}
