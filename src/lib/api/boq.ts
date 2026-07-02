// BOQ items helpers (Go BFF).
// Коммерческая материализация (bulkUpdateCommercial → PATCH /items/bulk-commercial)
// удалена с фронта: пересчёт коммерческих стоимостей выполняется авторитетно на
// сервере (Go BFF авто-пересчёт по изменению входных данных).
import { apiFetch } from './client';
import { API_BASE_URL } from './featureFlags';
import { getAccessToken as appAuthGetAccessToken } from '../auth/client';
import type { BoqItem, BoqItemInsert } from '../types';

/**
 * Каскадно пересчитать quantity+total_amount у всех materials-детей работы.
 * Go: одна pgx.Tx с audit-строкой на каждый ребёнок.
 */
export async function recomputeLinkedMaterials(workId: string): Promise<number> {
  const res = await apiFetch<{ data: { updated: number } }>(
    `/api/v1/items/${encodeURIComponent(workId)}/recompute-linked-materials`,
    { method: 'POST' },
  );
  return res.data.updated;
}

export interface CopyPositionItemsResult {
  works_count: number;
  materials_count: number;
  total_copied: number;
}

/** Скопировать ВСЕ boq_items из исходной позиции в целевую (одна tx + audit). */
export async function copyPositionItems(
  sourcePositionId: string,
  targetPositionId: string,
): Promise<CopyPositionItemsResult> {
  const res = await apiFetch<{ data: CopyPositionItemsResult }>(
    `/api/v1/positions/${encodeURIComponent(targetPositionId)}/copy-from`,
    {
      method: 'POST',
      body: JSON.stringify({ source_position_id: sourcePositionId }),
    },
  );
  return res.data;
}

// ─── audit history ──────────────────────────────────────────────────────────

export interface BoqAuditApiRow {
  id: string;
  boq_item_id: string;
  operation_type: string;
  changed_at: string;
  changed_by: string | null;
  changed_fields: string[] | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  user: { id: string; full_name: string | null; email: string | null } | null;
}

export interface BoqAuditListParams {
  positionId: string;
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  operationType?: string;
}

/**
 * boq_items_audit по позиции (JSONB-filter new_data/old_data → client_position_id)
 * + user embed; опциональные фильтры даты/пользователя/операции.
 */
export async function listBoqAuditByPosition(params: BoqAuditListParams): Promise<BoqAuditApiRow[]> {
  const qs = new URLSearchParams({ position_id: params.positionId });
  if (params.dateFrom) qs.set('date_from', params.dateFrom);
  if (params.dateTo) qs.set('date_to', params.dateTo);
  if (params.userId) qs.set('user_id', params.userId);
  if (params.operationType) qs.set('operation_type', params.operationType);
  const res = await apiFetch<{ data: BoqAuditApiRow[] }>(
    `/api/v1/boq-audit?${qs.toString()}`,
  );
  return res.data ?? [];
}

// ─── BOQ item write + audit (Go BFF /api/v1/items/*) ─────────────────────────
// user_id берётся из JWT, audit-строка пишется в той же pgx.Tx, что и мутация.

// Свежий Bearer из app-auth клиента (auto-refresh, coalesced). null = нет сессии
// → caller обязан трактовать как «нужна аутентификация», не как анонимный запрос.
async function getAuditAccessToken(): Promise<string | null> {
  return appAuthGetAccessToken();
}

// Читает ETag плоским fetch (apiFetch отбрасывает заголовки).
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

// PATCH с If-Match; на 412 возвращает conflict:true, чтобы caller ретраил.
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
  // DELETE идемпотентен: 404 = строки уже нет (например, снесена ON DELETE CASCADE
  // при удалении родительской работы) = цель достигнута, не ошибка.
  if (res.status === 404) return { conflict: false };
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DELETE /api/v1/items/${itemId} → ${res.status}: ${txt}`);
  }
  return { conflict: false };
}

/**
 * INSERT boq_item с audit: POST /api/v1/tenders/{id}/positions/{posId}/items
 * (user_id из JWT, audit-строка в той же pgx.Tx).
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
 * UPDATE boq_item с audit: GET (ETag) → PATCH If-Match. До 5 retry при 412 —
 * рядом крутятся фоновые пересчёты commercial cost, сбивающие ETag.
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
 * DELETE boq_item с audit: DELETE If-Match: * — идемпотентен, ETag не нужен.
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
