// Cost categories + detail cost categories + units (full row) — Go BFF only.

import type { Tables } from '../types/database.types';
import { apiFetch } from './client';

export type CostCategoryRow = Tables<'cost_categories'>;
export type DetailCostCategoryRow = Tables<'detail_cost_categories'>;
export type UnitRow = Tables<'units'>;

export interface DetailCostCategoryWithJoinedCategory extends DetailCostCategoryRow {
  cost_categories: CostCategoryRow | null;
}

// ─── Loading ────────────────────────────────────────────────────────────────

export async function listCostCategories(): Promise<CostCategoryRow[]> {
  const res = await apiFetch<{ data: CostCategoryRow[] }>('/api/v1/cost-categories', {
    cacheKey: 'cost-categories:all',
  });
  return res.data ?? [];
}

export async function listAllDetailCostCategoriesByOrder(): Promise<DetailCostCategoryRow[]> {
  const res = await apiFetch<{ data: DetailCostCategoryRow[] }>('/api/v1/detail-cost-categories', {
    cacheKey: 'detail-cost-categories:by-order',
  });
  return res.data ?? [];
}

export async function listCostCategoriesByIds(ids: string[]): Promise<CostCategoryRow[]> {
  if (ids.length === 0) return [];
  const qs = encodeURIComponent(ids.join(','));
  const res = await apiFetch<{ data: CostCategoryRow[] }>(`/api/v1/cost-categories?ids=${qs}`);
  return res.data ?? [];
}

export interface LocationRow {
  id: string;
  name?: string | null;
}

export async function listLocationsByIds(ids: string[]): Promise<LocationRow[]> {
  if (ids.length === 0) return [];
  const qs = encodeURIComponent(ids.join(','));
  const res = await apiFetch<{ data: LocationRow[] }>(`/api/v1/locations?ids=${qs}`);
  return res.data ?? [];
}

export async function listDetailCostCategoriesWithCategory(): Promise<DetailCostCategoryWithJoinedCategory[]> {
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

export async function listActiveUnitsFull(): Promise<UnitRow[]> {
  const res = await apiFetch<{ data: UnitRow[] }>('/api/v1/units/active', {
    cacheKey: 'units:active',
  });
  return res.data ?? [];
}

// ─── Cost categories writes ────────────────────────────────────────────────

export async function createCostCategory(input: { name: string; unit?: string }): Promise<CostCategoryRow> {
  const res = await apiFetch<{ data: CostCategoryRow }>('/api/v1/cost-categories', {
    method: 'POST',
    body: JSON.stringify({ name: input.name, unit: input.unit ?? null }),
  });
  return res.data;
}

export async function updateCostCategory(
  id: string,
  patch: { name?: string; unit?: string },
): Promise<void> {
  await apiFetch<undefined>(`/api/v1/cost-categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: patch.name ?? '', unit: patch.unit ?? null }),
  });
}

export async function deleteCostCategory(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/cost-categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function deleteAllCostCategories(): Promise<void> {
  await apiFetch<undefined>('/api/v1/cost-categories', { method: 'DELETE' });
}

export async function findCostCategoryByNameAndUnit(name: string, unit: string): Promise<CostCategoryRow | null> {
  const qs = `name=${encodeURIComponent(name)}&unit=${encodeURIComponent(unit)}`;
  const res = await apiFetch<{ data: CostCategoryRow | null }>(
    `/api/v1/cost-categories/find?${qs}`,
  );
  return res.data ?? null;
}

// ─── Detail cost categories writes ─────────────────────────────────────────

export async function getMaxDetailCostCategoryOrderNum(): Promise<number> {
  const res = await apiFetch<{ max_order_num: number }>(
    '/api/v1/detail-cost-categories/max-order-num',
  );
  return res.max_order_num ?? 0;
}

export interface DetailCostCategoryInput {
  cost_category_id?: string;
  name?: string;
  unit?: string;
  location?: string;
  order_num?: number;
}

export async function createDetailCostCategory(input: DetailCostCategoryInput): Promise<void> {
  await apiFetch<undefined>('/api/v1/detail-cost-categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateDetailCostCategory(
  id: string,
  patch: { name?: string; unit?: string; location?: string },
): Promise<void> {
  await apiFetch<undefined>(`/api/v1/detail-cost-categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteDetailCostCategory(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/detail-cost-categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function deleteAllDetailCostCategories(): Promise<void> {
  await apiFetch<undefined>('/api/v1/detail-cost-categories', { method: 'DELETE' });
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
  await apiFetch<undefined>('/api/v1/units/import-batch', {
    method: 'POST',
    body: JSON.stringify({ units }),
  });
}
