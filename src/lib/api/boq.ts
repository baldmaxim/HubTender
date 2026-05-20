// BOQ items helpers with Go BFF / Supabase fallback (Phase 4d/4e).
// Routes to /api/v1/items/bulk-commercial (port of
// bulk_update_boq_items_commercial_costs RPC) when VITE_API_BOQ_ENABLED=true.
import { apiFetch } from './client';

export interface BulkCommercialRow {
  id: string;
  commercial_markup?: number | null;
  total_commercial_material_cost?: number | null;
  total_commercial_work_cost?: number | null;
}

/**
 * Bulk update commercial cost columns on boq_items.
 * Returns the number of rows updated.
 * Go path: single PATCH in one pgx.Tx with per-tender grand-total recompute.
 * Supabase path: calls the bulk_update_boq_items_commercial_costs RPC.
 */
export async function bulkUpdateCommercial(rows: BulkCommercialRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const res = await apiFetch<{ updated: number }>(
    '/api/v1/items/bulk-commercial',
    { method: 'PATCH', body: JSON.stringify({ rows }) }
  );
  return res.updated;
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
