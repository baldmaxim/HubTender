// Data-access helpers for tender_registry / tender_statuses /
// construction_scopes with Go BFF / Supabase fallback.
//
// Go path: /api/v1/tender-registry/* + /api/v1/tender-statuses +
// /api/v1/construction-scopes. Toggle with VITE_API_TENDERREGISTRY_ENABLED.

import { supabase } from '../supabase';
import type {
  TenderRegistry,
  TenderRegistryInsert,
  TenderRegistryWithRelations,
  TenderStatus,
  ConstructionScope,
} from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

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
  if (isGoEnabled('tenderRegistry')) {
    const res = await apiFetch<{ data: TenderRegistryWithRelations[] }>('/api/v1/tender-registry', {
      cacheKey: 'tender-registry:list',
    });
    return res.data ?? [];
  }

  const { data, error } = await supabase
    .from('tender_registry')
    .select('*, status:status_id(id, name), construction_scope:construction_scope_id(id, name)')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TenderRegistryWithRelations[];
}

export async function fetchTenderStatuses(): Promise<TenderStatus[]> {
  if (isGoEnabled('tenderRegistry')) {
    const res = await apiFetch<{ data: TenderStatus[] }>('/api/v1/tender-statuses', {
      cacheKey: 'tender-statuses',
    });
    return res.data ?? [];
  }

  const { data, error } = await supabase.from('tender_statuses').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as TenderStatus[];
}

export async function fetchConstructionScopes(): Promise<ConstructionScope[]> {
  if (isGoEnabled('tenderRegistry')) {
    const res = await apiFetch<{ data: ConstructionScope[] }>('/api/v1/construction-scopes', {
      cacheKey: 'construction-scopes',
    });
    return res.data ?? [];
  }

  const { data, error } = await supabase.from('construction_scopes').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as ConstructionScope[];
}

export async function fetchTenderNumbers(): Promise<string[]> {
  if (isGoEnabled('tenderRegistry')) {
    const res = await apiFetch<{ data: string[] }>('/api/v1/tender-registry/tender-numbers');
    return res.data ?? [];
  }

  const { data, error } = await supabase
    .from('tenders')
    .select('tender_number')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((t) => t.tender_number).filter(Boolean) as string[]));
}

export async function fetchRelatedTendersByNumbers(numbers: string[]): Promise<RelatedTenderRow[]> {
  if (numbers.length === 0) return [];

  if (isGoEnabled('tenderRegistry')) {
    const qs = encodeURIComponent(numbers.join(','));
    const res = await apiFetch<{ data: RelatedTenderRow[] }>(
      `/api/v1/tender-registry/related-tenders?numbers=${qs}`,
    );
    return res.data ?? [];
  }

  const { data, error } = await supabase
    .from('tenders')
    .select('id, tender_number, version, cached_grand_total')
    .in('tender_number', numbers);
  if (error) throw error;
  return (data ?? []) as RelatedTenderRow[];
}

export async function fetchTenderRegistryAutocomplete(): Promise<TenderAutocomplete> {
  if (isGoEnabled('tenderRegistry')) {
    const res = await apiFetch<{ data: Array<{ title: string; client_name: string }> }>(
      '/api/v1/tender-registry/autocomplete',
    );
    const rows = res.data ?? [];
    return {
      titles: Array.from(new Set(rows.map((r) => r.title).filter(Boolean))),
      clientNames: Array.from(new Set(rows.map((r) => r.client_name).filter(Boolean))),
    };
  }

  const { data, error } = await supabase
    .from('tender_registry')
    .select('title, client_name')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = data ?? [];
  return {
    titles: Array.from(new Set(rows.map((item) => item.title).filter(Boolean) as string[])),
    clientNames: Array.from(new Set(rows.map((item) => item.client_name).filter(Boolean) as string[])),
  };
}

export async function getNextTenderRegistrySortOrder(): Promise<number> {
  if (isGoEnabled('tenderRegistry')) {
    const res = await apiFetch<{ next_sort_order: number }>(
      '/api/v1/tender-registry/next-sort-order',
    );
    return res.next_sort_order ?? 1;
  }

  const { data, error } = await supabase
    .from('tender_registry')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  if (error) throw error;
  const max = data?.[0]?.sort_order;
  return typeof max === 'number' ? max + 1 : 1;
}

export async function createTenderRegistry(payload: TenderRegistryInsert): Promise<void> {
  if (isGoEnabled('tenderRegistry')) {
    await apiFetch<undefined>('/api/v1/tender-registry', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return;
  }

  const { error } = await supabase.from('tender_registry').insert(payload);
  if (error) throw error;
}

export async function updateTenderRegistrySortOrder(id: string, sortOrder: number): Promise<void> {
  if (isGoEnabled('tenderRegistry')) {
    await apiFetch<undefined>(`/api/v1/tender-registry/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sort_order: sortOrder }),
    });
    return;
  }

  const { error } = await supabase
    .from('tender_registry')
    .update({ sort_order: sortOrder })
    .eq('id', id);
  if (error) throw error;
}

export async function archiveTenderRegistry(id: string): Promise<void> {
  if (isGoEnabled('tenderRegistry')) {
    await apiFetch<undefined>(`/api/v1/tender-registry/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_archived: true }),
    });
    return;
  }

  const { error } = await supabase
    .from('tender_registry')
    .update({ is_archived: true })
    .eq('id', id);
  if (error) throw error;
}

export async function swapTenderRegistrySortOrder(
  a: TenderRegistry,
  b: TenderRegistry,
): Promise<void> {
  await updateTenderRegistrySortOrder(a.id, b.sort_order ?? 0);
  await updateTenderRegistrySortOrder(b.id, a.sort_order ?? 0);
}
