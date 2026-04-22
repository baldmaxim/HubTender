// Tenders list helpers with Go BFF / Supabase fallback (Phase 4d).
// The Go endpoint returns the full tenders row — JSON keys match
// Database['public']['Tables']['tenders']['Row'], so the Supabase `Tender`
// type works at both call sites without adaptation.
import { supabase } from '../supabase';
import type { Tender } from '../supabase/types';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

export interface ListTendersParams {
  isArchived?: boolean;
  housingClass?: string;
  search?: string;
}

interface GoListResponse {
  data: Tender[];
  next_cursor?: string;
}

const GO_PAGE_SIZE = 200;
const GO_MAX_PAGES = 10; // safety cap — 2000 rows is enough for admin UI

async function fetchAllFromGo(params?: ListTendersParams): Promise<Tender[]> {
  const all: Tender[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < GO_MAX_PAGES; page++) {
    const qs = new URLSearchParams();
    qs.set('limit', String(GO_PAGE_SIZE));
    if (cursor) qs.set('cursor', cursor);
    if (params?.isArchived !== undefined) qs.set('is_archived', String(params.isArchived));
    if (params?.housingClass) qs.set('housing_class', params.housingClass);
    if (params?.search) qs.set('search', params.search);

    const res = await apiFetch<GoListResponse>(`/api/v1/tenders?${qs.toString()}`);
    all.push(...res.data);
    if (!res.next_cursor) return all;
    cursor = res.next_cursor;
  }
  return all;
}

/** List tenders. Routes to Go BFF when `VITE_API_TENDERS_ENABLED=true`. */
export async function fetchTenders(params?: ListTendersParams): Promise<Tender[]> {
  if (isGoEnabled('tenders')) {
    return fetchAllFromGo(params);
  }

  let q = supabase.from('tenders').select('*');
  if (params?.isArchived !== undefined) q = q.eq('is_archived', params.isArchived);
  if (params?.housingClass) q = q.eq('housing_class', params.housingClass);
  if (params?.search) {
    q = q.or(`title.ilike.%${params.search}%,client_name.ilike.%${params.search}%`);
  }
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Tender[];
}

/** Bulk fetch tenders by id. Go path filters the list response in-memory. */
export async function fetchTendersByIds(ids: string[]): Promise<Tender[]> {
  if (ids.length === 0) return [];

  if (isGoEnabled('tenders')) {
    const all = await fetchAllFromGo();
    const set = new Set(ids);
    return all.filter(t => set.has(t.id));
  }

  const { data, error } = await supabase.from('tenders').select('*').in('id', ids);
  if (error) throw error;
  return (data ?? []) as Tender[];
}
