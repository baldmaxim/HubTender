import { supabase } from './supabase';
import type { BoqItemInsert } from './supabase';
import { apiFetch } from './api/client';
import { isGoEnabled, API_BASE_URL } from './api/featureFlags';

// ─── Go path helpers ────────────────────────────────────────────────────────
// Reads the ETag header from a plain fetch (apiFetch discards headers).
async function fetchItemETag(itemId: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(
    `${API_BASE_URL}/api/v1/items/${encodeURIComponent(itemId)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
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
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(
    `${API_BASE_URL}/api/v1/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(
    `${API_BASE_URL}/api/v1/items/${encodeURIComponent(itemId)}`,
    {
      method: 'DELETE',
      headers: {
        'If-Match': etag,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
 * При VITE_API_BOQ_ENABLED=true идёт в Go BFF (user_id из JWT, audit в
 * pgx.Tx), иначе — supabase.rpc('insert_boq_item_with_audit').
 */
export async function insertBoqItemWithAudit(
  userId: string | undefined,
  data: Partial<BoqItemInsert>,
) {
  if (!userId) {
    throw new Error('User ID required for audit operations');
  }

  if (isGoEnabled('boq')) {
    const { tender_id, client_position_id, ...rest } = data as Record<string, unknown>;
    if (!tender_id || !client_position_id) {
      throw new Error('tender_id and client_position_id are required for Go INSERT path');
    }
    try {
      const res = await apiFetch<{ data: unknown }>(
        `/api/v1/tenders/${encodeURIComponent(String(tender_id))}/positions/${encodeURIComponent(String(client_position_id))}/items`,
        { method: 'POST', body: JSON.stringify(rest) },
      );
      return { data: res.data, error: null };
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  const { data: result, error } = await supabase.rpc('insert_boq_item_with_audit', {
    p_user_id: userId,
    p_data: data as unknown,
  });

  if (error) throw error;
  return { data: result, error: null };
}

/**
 * Wrapper для UPDATE операций с автоматическим audit логированием.
 * Go path: GET (для ETag) → PATCH with If-Match. При 412 — один retry.
 */
export async function updateBoqItemWithAudit(
  userId: string | undefined,
  itemId: string,
  data: Partial<BoqItemInsert>,
) {
  if (!userId) {
    throw new Error('User ID required for audit operations');
  }

  if (isGoEnabled('boq')) {
    const body = data as Record<string, unknown>;
    // Attempt 1.
    let etag = await fetchItemETag(itemId);
    let res = await patchItemOnce(itemId, body, etag);
    if (res.conflict) {
      // Attempt 2 with fresh ETag ("last-write-wins" semantic like the RPC).
      etag = await fetchItemETag(itemId);
      res = await patchItemOnce(itemId, body, etag);
      if (res.conflict) {
        throw new Error('Item was modified concurrently by another user. Please reload.');
      }
    }
    return { data: res.data, error: null };
  }

  const { data: result, error } = await supabase.rpc('update_boq_item_with_audit', {
    p_user_id: userId,
    p_item_id: itemId,
    p_data: data as unknown,
  });

  if (error) throw error;
  return { data: result, error: null };
}

/**
 * Wrapper для DELETE операций с автоматическим audit логированием.
 * Go path: GET (для ETag) → DELETE with If-Match. При 412 — один retry.
 */
export async function deleteBoqItemWithAudit(
  userId: string | undefined,
  itemId: string,
) {
  if (!userId) {
    throw new Error('User ID required for audit operations');
  }

  if (isGoEnabled('boq')) {
    let etag = await fetchItemETag(itemId);
    let res = await deleteItemOnce(itemId, etag);
    if (res.conflict) {
      etag = await fetchItemETag(itemId);
      res = await deleteItemOnce(itemId, etag);
      if (res.conflict) {
        throw new Error('Item was modified concurrently by another user. Please reload.');
      }
    }
    return { data: null, error: null };
  }

  const { data: result, error } = await supabase.rpc('delete_boq_item_with_audit', {
    p_user_id: userId,
    p_item_id: itemId,
  });

  if (error) throw error;
  return { data: result, error: null };
}

