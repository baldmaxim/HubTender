// Per-user position filter persistence with Go BFF / Supabase fallback.
// Go path: /api/v1/tenders/:id/position-filters (GET/PUT/POST/DELETE).
// Supabase path: direct table CRUD on public.user_position_filters.

import { supabase } from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

const INSERT_BATCH = 100;

export async function listUserPositionFilter(
  userID: string,
  tenderID: string,
): Promise<string[]> {
  if (isGoEnabled('positionFilters')) {
    const res = await apiFetch<{ data: string[] }>(
      `/api/v1/tenders/${encodeURIComponent(tenderID)}/position-filters`,
    );
    return res.data ?? [];
  }

  const { data, error } = await supabase
    .from('user_position_filters')
    .select('position_id')
    .eq('user_id', userID)
    .eq('tender_id', tenderID);
  if (error) throw error;
  return (data ?? []).map((row) => row.position_id as string);
}

export async function clearUserPositionFilter(userID: string, tenderID: string): Promise<void> {
  if (isGoEnabled('positionFilters')) {
    await apiFetch<undefined>(
      `/api/v1/tenders/${encodeURIComponent(tenderID)}/position-filters`,
      { method: 'DELETE' },
    );
    return;
  }

  const { error } = await supabase
    .from('user_position_filters')
    .delete()
    .eq('user_id', userID)
    .eq('tender_id', tenderID);
  if (error) throw error;
}

export async function insertUserPositionFilter(
  userID: string,
  tenderID: string,
  positionIds: string[],
): Promise<void> {
  if (positionIds.length === 0) return;

  if (isGoEnabled('positionFilters')) {
    // Go path replaces the whole filter set transactionally — pass the full
    // list. Caller uses clearUserPositionFilter beforehand only on the
    // Supabase path; on Go we let the server do the replace atomically.
    await apiFetch<undefined>(
      `/api/v1/tenders/${encodeURIComponent(tenderID)}/position-filters`,
      { method: 'PUT', body: JSON.stringify({ position_ids: positionIds }) },
    );
    return;
  }

  const records = positionIds.map((positionId) => ({
    user_id: userID,
    tender_id: tenderID,
    position_id: positionId,
  }));
  for (let i = 0; i < records.length; i += INSERT_BATCH) {
    const batch = records.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from('user_position_filters').insert(batch);
    if (error) throw error;
  }
}

export async function appendUserPositionFilter(
  userID: string,
  tenderID: string,
  positionID: string,
): Promise<void> {
  if (isGoEnabled('positionFilters')) {
    await apiFetch<undefined>(
      `/api/v1/tenders/${encodeURIComponent(tenderID)}/position-filters/append`,
      { method: 'POST', body: JSON.stringify({ position_id: positionID }) },
    );
    return;
  }

  const { error } = await supabase.from('user_position_filters').insert({
    user_id: userID,
    tender_id: tenderID,
    position_id: positionID,
  });
  if (error) throw error;
}
