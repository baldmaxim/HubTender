// Data-access helpers for tender_registry / tender_statuses /
// construction_scopes — Go BFF only.
// /api/v1/tender-registry/* + /api/v1/tender-statuses +
// /api/v1/construction-scopes.

import type {
  TenderRegistry,
  TenderRegistryInsert,
  TenderRegistryWithRelations,
  TenderStatus,
  ConstructionScope,
} from '../supabase';
import { apiFetch } from './client';

export interface TenderAutocomplete {
  titles: string[];
  clientNames: string[];
}

interface RelatedTenderRow {
  id: string;
  tender_number: string | null;
  version: number | null;
  cached_grand_total: number | null;
}

export async function fetchTenderRegistryWithRelations(): Promise<TenderRegistryWithRelations[]> {
  const res = await apiFetch<{ data: TenderRegistryWithRelations[] }>('/api/v1/tender-registry', {
    cacheKey: 'tender-registry:list',
  });
  return res.data ?? [];
}

export async function fetchTenderStatuses(): Promise<TenderStatus[]> {
  const res = await apiFetch<{ data: TenderStatus[] }>('/api/v1/tender-statuses', {
    cacheKey: 'tender-statuses',
  });
  return res.data ?? [];
}

export async function fetchConstructionScopes(): Promise<ConstructionScope[]> {
  const res = await apiFetch<{ data: ConstructionScope[] }>('/api/v1/construction-scopes', {
    cacheKey: 'construction-scopes',
  });
  return res.data ?? [];
}

export async function fetchTenderNumbers(): Promise<string[]> {
  const res = await apiFetch<{ data: string[] }>('/api/v1/tender-registry/tender-numbers');
  return res.data ?? [];
}

export async function fetchRelatedTendersByNumbers(numbers: string[]): Promise<RelatedTenderRow[]> {
  if (numbers.length === 0) return [];
  const qs = encodeURIComponent(numbers.join(','));
  const res = await apiFetch<{ data: RelatedTenderRow[] }>(
    `/api/v1/tender-registry/related-tenders?numbers=${qs}`,
  );
  return res.data ?? [];
}

export async function fetchTenderRegistryAutocomplete(): Promise<TenderAutocomplete> {
  const res = await apiFetch<{ data: Array<{ title: string; client_name: string }> }>(
    '/api/v1/tender-registry/autocomplete',
  );
  const rows = res.data ?? [];
  return {
    titles: Array.from(new Set(rows.map((r) => r.title).filter(Boolean))),
    clientNames: Array.from(new Set(rows.map((r) => r.client_name).filter(Boolean))),
  };
}

export async function getNextTenderRegistrySortOrder(): Promise<number> {
  const res = await apiFetch<{ next_sort_order: number }>(
    '/api/v1/tender-registry/next-sort-order',
  );
  return res.next_sort_order ?? 1;
}

export async function createTenderRegistry(payload: TenderRegistryInsert): Promise<void> {
  await apiFetch<undefined>('/api/v1/tender-registry', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTenderRegistrySortOrder(id: string, sortOrder: number): Promise<void> {
  await apiFetch<undefined>(`/api/v1/tender-registry/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sort_order: sortOrder }),
  });
}

export async function archiveTenderRegistry(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/tender-registry/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_archived: true }),
  });
}

export async function swapTenderRegistrySortOrder(
  a: TenderRegistry,
  b: TenderRegistry,
): Promise<void> {
  await updateTenderRegistrySortOrder(a.id, b.sort_order ?? 0);
  await updateTenderRegistrySortOrder(b.id, a.sort_order ?? 0);
}
