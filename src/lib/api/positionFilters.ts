// Per-user position filter persistence — Go BFF only.
// /api/v1/tenders/:id/position-filters (GET/PUT/POST/DELETE); user_id из JWT
// (поэтому userID-параметры больше не используются — оставлены для
// совместимости сигнатуры с вызывающими).

import { apiFetch } from './client';

export async function listUserPositionFilter(
  _userID: string,
  tenderID: string,
): Promise<string[]> {
  const res = await apiFetch<{ data: string[] }>(
    `/api/v1/tenders/${encodeURIComponent(tenderID)}/position-filters`,
  );
  return res.data ?? [];
}

export async function clearUserPositionFilter(_userID: string, tenderID: string): Promise<void> {
  await apiFetch<undefined>(
    `/api/v1/tenders/${encodeURIComponent(tenderID)}/position-filters`,
    { method: 'DELETE' },
  );
}

export async function insertUserPositionFilter(
  _userID: string,
  tenderID: string,
  positionIds: string[],
): Promise<void> {
  if (positionIds.length === 0) return;
  // Go path заменяет весь набор фильтров транзакционно (PUT).
  await apiFetch<undefined>(
    `/api/v1/tenders/${encodeURIComponent(tenderID)}/position-filters`,
    { method: 'PUT', body: JSON.stringify({ position_ids: positionIds }) },
  );
}

export async function appendUserPositionFilter(
  _userID: string,
  tenderID: string,
  positionID: string,
): Promise<void> {
  await apiFetch<undefined>(
    `/api/v1/tenders/${encodeURIComponent(tenderID)}/position-filters/append`,
    { method: 'POST', body: JSON.stringify({ position_id: positionID }) },
  );
}
