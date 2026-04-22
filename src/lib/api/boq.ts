// BOQ items helpers with Go BFF / Supabase fallback (Phase 4d/4e).
// Routes to /api/v1/items/bulk-commercial (port of
// bulk_update_boq_items_commercial_costs RPC) when VITE_API_BOQ_ENABLED=true.
import { supabase } from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

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

  if (isGoEnabled('boq')) {
    const res = await apiFetch<{ updated: number }>(
      '/api/v1/items/bulk-commercial',
      { method: 'PATCH', body: JSON.stringify({ rows }) }
    );
    return res.updated;
  }

  const { data, error } = await supabase.rpc('bulk_update_boq_items_commercial_costs', {
    p_rows: rows,
  });
  if (error) throw error;
  return Number(data) || 0;
}
