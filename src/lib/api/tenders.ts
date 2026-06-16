// Tenders list helpers with Go BFF / Supabase fallback (Phase 4d).
// The Go endpoint returns the full tenders row — JSON keys match
// Database['public']['Tables']['tenders']['Row'], so the Supabase `Tender`
// type works at both call sites without adaptation.
import type { Tender } from '../supabase/types';
import { apiFetch } from './client';

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

    const res = await apiFetch<GoListResponse>(`/api/v1/tenders?${qs.toString()}`, { cache: 'no-store' });
    all.push(...res.data);
    if (!res.next_cursor) return all;
    cursor = res.next_cursor;
  }
  return all;
}

/** List tenders. Routes to Go BFF when `VITE_API_TENDERS_ENABLED=true`. */
export async function fetchTenders(params?: ListTendersParams): Promise<Tender[]> {
  return fetchAllFromGo(params);
}

/** Bulk fetch tenders by id. Go path filters the list response in-memory. */
export async function fetchTendersByIds(ids: string[]): Promise<Tender[]> {
  if (ids.length === 0) return [];

  const all = await fetchAllFromGo();
  const set = new Set(ids);
  return all.filter(t => set.has(t.id));
}

/** Создать тендер. Возвращает созданную строку. */
export interface CreateTenderInput {
  title: string;
  description?: string | null;
  client_name: string;
  tender_number: string;
  submission_deadline?: string | null;
  version?: number;
  area_client?: number | null;
  area_sp?: number | null;
  usd_rate?: number | null;
  eur_rate?: number | null;
  cny_rate?: number | null;
  upload_folder?: string | null;
  bsm_link?: string | null;
  tz_link?: string | null;
  qa_form_link?: string | null;
  project_folder_link?: string | null;
  housing_class?: string | null;
  construction_scope?: string | null;
}

export async function createTender(input: CreateTenderInput): Promise<Tender> {
  const res = await apiFetch<{ data: Tender }>('/api/v1/tenders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

/** Точечный PATCH полей тендера для админ-страницы (без ETag-проверки). */
export type AdminTenderPatch = Partial<CreateTenderInput> & {
  is_archived?: boolean;
  markup_tactic_id?: string;
  volume_title?: string;
};

export async function adminPatchTender(id: string, patch: AdminTenderPatch): Promise<void> {
  await apiFetch<undefined>(`/api/v1/tenders/${encodeURIComponent(id)}/admin-fields`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Удалить тендер. */
export async function deleteTender(id: string): Promise<void> {
  // Удаление крупного тендера — тяжёлая операция (FK-каскад по тысячам
  // boq_items/client_positions); отключаем дефолтный 10s-таймаут apiFetch,
  // как у cloneTenderAsNewVersion / executeVersionTransfer.
  await apiFetch<undefined>(`/api/v1/tenders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    timeoutMs: 0,
  });
}
