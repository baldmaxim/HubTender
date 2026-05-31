// construction_cost_volumes helpers — Go BFF only.
import { apiFetch } from './client';

export interface ConstructionCostVolume {
  id: string;
  tender_id: string;
  detail_cost_category_id: string | null;
  group_key: string | null;
  volume: number | null;
  notes?: string | null;
}

/** GET /api/v1/tenders/{id}/construction-cost-volumes */
export async function listConstructionCostVolumes(tenderId: string): Promise<ConstructionCostVolume[]> {
  const res = await apiFetch<{ data: ConstructionCostVolume[] }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/construction-cost-volumes`,
    { cache: 'no-store' },
  );
  return res.data ?? [];
}

/** Upsert (on tender+detail_cost_category_id OR tender+group_key). */
export async function upsertConstructionCostVolume(input: {
  tender_id: string;
  detail_cost_category_id?: string | null;
  group_key?: string | null;
  volume: number;
  notes?: string | null;
}): Promise<void> {
  await apiFetch<undefined>('/api/v1/construction-cost-volumes', {
    method: 'POST',
    body: JSON.stringify({
      tender_id: input.tender_id,
      detail_cost_category_id: input.detail_cost_category_id ?? null,
      group_key: input.group_key ?? null,
      volume: input.volume,
      notes: input.notes ?? null,
    }),
  });
}
