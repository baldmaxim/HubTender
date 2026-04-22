// Positions-with-costs helper with Go BFF / Supabase fallback (Phase 4d).
// Routes to GET /api/v1/tenders/:id/positions/with-costs (which ports the
// public.get_positions_with_costs RPC) when VITE_API_POSITIONS_ENABLED=true.
import { supabase } from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

// Exported type — consumers usually redefine it inline; this is the authoritative shape.
export interface PositionWithCostsRow {
  id: string;
  tender_id: string;
  position_number: number;
  unit_code: string | null;
  volume: number | null;
  client_note: string | null;
  item_no: string | null;
  work_name: string;
  manual_volume: number | null;
  manual_note: string | null;
  hierarchy_level: number | null;
  is_additional: boolean | null;
  parent_position_id: string | null;
  total_material: number | null;
  total_works: number | null;
  material_cost_per_unit: number | null;
  work_cost_per_unit: number | null;
  total_commercial_material: number | null;
  total_commercial_work: number | null;
  total_commercial_material_per_unit: number | null;
  total_commercial_work_per_unit: number | null;
  created_at: string;
  updated_at: string;
  base_total: number | null;
  commercial_total: number | null;
  material_cost_total: number | null;
  work_cost_total: number | null;
  markup_percentage: number | null;
  items_count: number | null;
}

/**
 * Fetch positions-with-costs aggregate for a tender.
 * Go path: single request, ~30s server cache + singleflight.
 * Supabase path: paginated RPC calls in 1000-row chunks.
 */
export async function fetchPositionsWithCosts(tenderId: string): Promise<PositionWithCostsRow[]> {
  if (isGoEnabled('positions')) {
    const res = await apiFetch<{ data: PositionWithCostsRow[] }>(
      `/api/v1/tenders/${encodeURIComponent(tenderId)}/positions/with-costs`
    );
    return res.data ?? [];
  }

  // Supabase fallback — paginate via .range() like the original call site.
  const PAGE = 1000;
  const all: PositionWithCostsRow[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const to = from + PAGE - 1;
    const { data, error } = await supabase
      .rpc('get_positions_with_costs', { p_tender_id: tenderId })
      .range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as PositionWithCostsRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}
