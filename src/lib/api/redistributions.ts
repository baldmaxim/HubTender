import { supabase } from '../supabase';
import type { RedistributionRule } from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

export interface RedistributionRecord {
  boq_item_id: string;
  original_work_cost: number;
  deducted_amount: number;
  added_amount: number;
  final_work_cost: number;
}

export interface SaveRedistributionInput {
  tenderId: string;
  tacticId: string;
  records: RedistributionRecord[];
  rules: RedistributionRule;
  createdBy?: string | null;
}

/**
 * Atomically persist a redistribution snapshot.
 *
 * Go path (VITE_API_REDISTRIBUTIONS_ENABLED=true):
 *   POST /api/v1/redistributions/save — one pgx.Tx:
 *     - DELETE rows whose boq_item_id is not in the new set.
 *     - UPSERT new rows ON CONFLICT (tender_id, markup_tactic_id, boq_item_id).
 *     - rules JSONB lives on a single deterministic row (smallest boq_item_id).
 *
 * Supabase fallback: одиночный вызов RPC `save_redistribution_results`.
 * Функция делает всё в одной транзакции — snap rules → delete non-matching →
 * upsert. Раньше здесь было два round-trip'а (upsert + delete.not.in с
 * NOT IN (...5000 uuids)) — см. миграцию 00000000000014.
 */
export async function saveRedistributionResults(
  input: SaveRedistributionInput
): Promise<number> {
  const { tenderId, tacticId, records, rules, createdBy } = input;
  if (records.length === 0) return 0;

  if (isGoEnabled('redistributions')) {
    const res = await apiFetch<{ data: { saved_count: number } }>(
      '/api/v1/redistributions/save',
      {
        method: 'POST',
        body: JSON.stringify({
          tender_id: tenderId,
          markup_tactic_id: tacticId,
          records,
          rules,
        }),
      }
    );
    return res.data.saved_count;
  }

  const { data, error } = await supabase.rpc('save_redistribution_results', {
    p_tender_id: tenderId,
    p_markup_tactic_id: tacticId,
    p_records: records as unknown as Record<string, unknown>[],
    p_rules: rules as unknown as Record<string, unknown>,
    p_created_by: createdBy ?? null,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : records.length;
}
