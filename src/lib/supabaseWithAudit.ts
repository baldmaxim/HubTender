// =============================================================================
// DEPRECATED MODULE — legacy "BOQ items write with audit" wrapper.
//
// Why this still exists:
//   The four call-sites in src/pages/PositionItems/ predate the typed BOQ
//   api wrappers. Every mutation goes through Go BFF
//   (/api/v1/items/* + /api/v1/tenders/.../items).
//
// TODO: replace all four call-sites (PositionItems.tsx + 3 hooks) with the
// typed wrappers in src/lib/api/boq.ts, then delete this module.
// =============================================================================

import type { BoqItem, BoqItemInsert } from './supabase';
import { apiFetch } from './api/client';
import { API_BASE_URL } from './api/featureFlags';
import { getAccessToken as appAuthGetAccessToken } from './auth/client';

// getAuditAccessToken returns a fresh Bearer token from the app-auth client
// (auto-refresh on near-expiry, coalesced refresh per tab). Returns null when
// no session exists — callers MUST treat that as authentication-required,
// never as "send the request anonymously".
async function getAuditAccessToken(): Promise<string | null> {
  return appAuthGetAccessToken();
}

// ─── Go path helpers ────────────────────────────────────────────────────────
// Reads the ETag header from a plain fetch (apiFetch discards headers).
// cache: 'no-store' — иначе браузер на retry отдаёт закэшированный ETag,
// сервер видит свежий updated_at и стабильно возвращает 412.
async function fetchItemETag(itemId: string): Promise<string> {
  const token = await getAuditAccessToken();
  if (!token) throw new Error('Authentication required');
  const res = await fetch(
    `${API_BASE_URL}/api/v1/items/${encodeURIComponent(itemId)}`,
    {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET /api/v1/items/${itemId} → ${res.status}: ${body}`);
  }
  const etag = res.headers.get('ETag');
  if (!etag) throw new Error(`GET /api/v1/items/${itemId}: missing ETag header`);
  return etag;
}

// PATCH with If-Match; on 412 returns true so caller can retry.
async function patchItemOnce(
  itemId: string,
  body: Record<string, unknown>,
  etag: string,
): Promise<{ data: unknown; conflict: boolean }> {
  const token = await getAuditAccessToken();
  if (!token) throw new Error('Authentication required');
  const res = await fetch(
    `${API_BASE_URL}/api/v1/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  if (res.status === 412) return { data: null, conflict: true };
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PATCH /api/v1/items/${itemId} → ${res.status}: ${txt}`);
  }
  return { data: (await res.json()).data, conflict: false };
}

async function deleteItemOnce(itemId: string, etag: string): Promise<{ conflict: boolean }> {
  const token = await getAuditAccessToken();
  if (!token) throw new Error('Authentication required');
  const res = await fetch(
    `${API_BASE_URL}/api/v1/items/${encodeURIComponent(itemId)}`,
    {
      method: 'DELETE',
      headers: {
        'If-Match': etag,
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (res.status === 412) return { conflict: true };
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DELETE /api/v1/items/${itemId} → ${res.status}: ${txt}`);
  }
  return { conflict: false };
}

// ─── Public wrappers ────────────────────────────────────────────────────────
/**
 * Wrapper для INSERT операций с автоматическим audit логированием.
 * Только Go BFF: POST /api/v1/tenders/{id}/positions/{posId}/items
 * (user_id из JWT, audit-строка в той же pgx.Tx). Supabase-fallback убран.
 */
export async function insertBoqItemWithAudit(
  userId: string | undefined,
  data: Partial<BoqItemInsert>,
) {
  if (!userId) {
    throw new Error('User ID required for audit operations');
  }

  const { tender_id, client_position_id, ...rest } = data as Record<string, unknown>;
  if (!tender_id || !client_position_id) {
    throw new Error('tender_id and client_position_id are required for INSERT path');
  }
  try {
    const res = await apiFetch<{ data: BoqItem }>(
      `/api/v1/tenders/${encodeURIComponent(String(tender_id))}/positions/${encodeURIComponent(String(client_position_id))}/items`,
      { method: 'POST', body: JSON.stringify(rest) },
    );
    return { data: res.data, error: null };
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Wrapper для UPDATE операций с автоматическим audit логированием.
 * Go path: GET (для ETag) → PATCH with If-Match. До 5 retry при 412 — на странице
 * BoQ часто рядом крутятся фоновые пересчёты commercial cost, которые гонятся
 * за ту же строку и сбивают ETag.
 */
export async function updateBoqItemWithAudit(
  userId: string | undefined,
  itemId: string,
  data: Partial<BoqItemInsert>,
) {
  if (!userId) {
    throw new Error('User ID required for audit operations');
  }

  const body = data as Record<string, unknown>;
  const maxAttempts = 5;
  let res: Awaited<ReturnType<typeof patchItemOnce>> = { data: null, conflict: true };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const etag = await fetchItemETag(itemId);
    res = await patchItemOnce(itemId, body, etag);
    if (!res.conflict) {
      return { data: res.data, error: null };
    }
    if (attempt < maxAttempts) {
      // Лёгкая экспоненциальная задержка: 50/100/200/400 мс. Даёт фоновому
      // пересчёту шанс закрыть свой апдейт прежде чем мы ретраимся.
      await new Promise((r) => setTimeout(r, 50 * 2 ** (attempt - 1)));
    }
  }
  throw new Error('Item was modified concurrently by another user. Please reload.');
}

/**
 * Wrapper для DELETE операций с автоматическим audit логированием.
 * Go path: DELETE с If-Match: * — удаляет если строка существует. ETag-проверка
 * не нужна, т.к. delete идемпотентен и не теряет чужих изменений.
 */
export async function deleteBoqItemWithAudit(
  userId: string | undefined,
  itemId: string,
) {
  if (!userId) {
    throw new Error('User ID required for audit operations');
  }

  const res = await deleteItemOnce(itemId, '*');
  if (res.conflict) {
    throw new Error('Не удалось удалить строку: сервер отклонил DELETE.');
  }
  return { data: null, error: null };
}

