// Markup tactics + parameters + tender markup percentages + pricing
// distribution + subcontract growth exclusions — Go BFF only.

import type {
  MarkupParameter,
  MarkupTactic,
  PricingDistribution,
  PricingDistributionInsert,
  TenderMarkupPercentageInsert,
} from '../supabase';
import { apiFetch } from './client';

// ─── markup_tactics ─────────────────────────────────────────────────────────

export async function listMarkupTactics(): Promise<MarkupTactic[]> {
  const res = await apiFetch<{ data: MarkupTactic[] }>('/api/v1/markup/tactics', {
    cacheKey: 'markup:tactics',
  });
  return res.data ?? [];
}

export async function getMarkupTactic(id: string): Promise<MarkupTactic | null> {
  try {
    const res = await apiFetch<{ data: MarkupTactic | null }>(
      `/api/v1/markup/tactics/${encodeURIComponent(id)}`,
    );
    return res.data ?? null;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    throw err;
  }
}

export async function findGlobalMarkupTacticByName(name: string): Promise<MarkupTactic | null> {
  const res = await apiFetch<{ data: MarkupTactic | null }>(
    `/api/v1/markup/tactics/global-by-name?name=${encodeURIComponent(name)}`,
  );
  return res.data ?? null;
}

export interface MarkupTacticInput {
  name: string;
  sequences: Record<string, unknown>;
  base_costs: Record<string, number>;
  is_global?: boolean;
}

export async function createMarkupTactic(input: MarkupTacticInput): Promise<MarkupTactic> {
  const res = await apiFetch<{ data: MarkupTactic }>('/api/v1/markup/tactics', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateMarkupTactic(id: string, input: Partial<MarkupTacticInput>): Promise<MarkupTactic> {
  await apiFetch<undefined>(`/api/v1/markup/tactics/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  const fresh = await getMarkupTactic(id);
  if (!fresh) throw new Error('updateMarkupTactic: tactic disappeared after update');
  return fresh;
}

export async function renameMarkupTactic(id: string, name: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/markup/tactics/${encodeURIComponent(id)}/rename`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteMarkupTactic(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/markup/tactics/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── markup_parameters ─────────────────────────────────────────────────────

export async function listActiveMarkupParameters(): Promise<MarkupParameter[]> {
  const res = await apiFetch<{ data: MarkupParameter[] }>('/api/v1/markup/parameters', {
    cacheKey: 'markup:parameters',
  });
  return res.data ?? [];
}

export interface MarkupParameterInput {
  key: string;
  label: string;
  is_active?: boolean;
  order_num?: number;
  default_value?: number;
}

export async function createMarkupParameter(input: MarkupParameterInput): Promise<void> {
  await apiFetch<undefined>('/api/v1/markup/parameters', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateMarkupParameter(
  id: string,
  patch: Partial<Pick<MarkupParameter, 'label' | 'default_value' | 'order_num' | 'is_active'>>,
): Promise<void> {
  await apiFetch<undefined>(`/api/v1/markup/parameters/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteMarkupParameter(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/markup/parameters/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function setMarkupParameterOrderNum(id: string, orderNum: number): Promise<void> {
  await apiFetch<undefined>(`/api/v1/markup/parameters/${encodeURIComponent(id)}/order-num`, {
    method: 'PATCH',
    body: JSON.stringify({ order_num: orderNum }),
  });
}

// ─── tender markup tactic linkage ───────────────────────────────────────────

export async function getTenderMarkupTacticId(tenderId: string): Promise<string | null> {
  const res = await apiFetch<{ markup_tactic_id: string | null }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/markup/tactic-id`,
  );
  return res.markup_tactic_id ?? null;
}

export async function setTenderMarkupTacticId(tenderId: string, tacticId: string): Promise<void> {
  await apiFetch<undefined>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/markup/tactic-id`,
    { method: 'PUT', body: JSON.stringify({ markup_tactic_id: tacticId }) },
  );
}

// ─── tender_markup_percentage ──────────────────────────────────────────────

export interface TenderMarkupPercentageRow {
  id: string;
  tender_id: string;
  markup_parameter_id: string;
  value: number;
  markup_parameter: MarkupParameter | null;
}

export async function listTenderMarkupPercentages(tenderId: string): Promise<TenderMarkupPercentageRow[]> {
  const res = await apiFetch<{ data: TenderMarkupPercentageRow[] }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/markup/percentages`,
  );
  return res.data ?? [];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deleteTenderMarkupPercentages(_tenderId: string): Promise<void> {
  // No-op on Go: the replace is atomic via insertTenderMarkupPercentages
  // (PUT). Kept for caller compatibility (legacy delete+insert flow).
}

export async function insertTenderMarkupPercentages(records: TenderMarkupPercentageInsert[]): Promise<void> {
  if (records.length === 0) return;
  const tenderId = String(records[0].tender_id);
  await apiFetch<undefined>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/markup/percentages`,
    {
      method: 'PUT',
      body: JSON.stringify({
        records: records.map((r) => ({
          tender_id: r.tender_id,
          markup_parameter_id: r.markup_parameter_id,
          value: r.value ?? 0,
        })),
      }),
    },
  );
}

// ─── subcontract_growth_exclusions ─────────────────────────────────────────

export type SubcontractExclusionType = 'works' | 'materials';

export interface SubcontractExclusionRow {
  detail_cost_category_id: string;
  exclusion_type: SubcontractExclusionType;
}

export async function listSubcontractGrowthExclusionsForTender(
  tenderId: string,
): Promise<SubcontractExclusionRow[]> {
  const res = await apiFetch<{ data: SubcontractExclusionRow[] }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/markup/exclusions`,
  );
  return res.data ?? [];
}

export async function insertSubcontractGrowthExclusion(input: {
  tender_id: string;
  detail_cost_category_id: string;
  exclusion_type: SubcontractExclusionType;
}): Promise<void> {
  await apiFetch<undefined>('/api/v1/markup/exclusions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function insertSubcontractGrowthExclusionsBatch(rows: Array<{
  tender_id: string;
  detail_cost_category_id: string;
  exclusion_type: SubcontractExclusionType;
}>): Promise<void> {
  if (rows.length === 0) return;
  await apiFetch<undefined>('/api/v1/markup/exclusions/batch', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

export async function deleteSubcontractGrowthExclusion(input: {
  tender_id: string;
  detail_cost_category_id: string;
  exclusion_type: SubcontractExclusionType;
}): Promise<void> {
  await apiFetch<undefined>('/api/v1/markup/exclusions', {
    method: 'DELETE',
    body: JSON.stringify(input),
  });
}

export async function deleteSubcontractGrowthExclusionsBatch(input: {
  tender_id: string;
  detail_cost_category_ids: string[];
  exclusion_type: SubcontractExclusionType;
}): Promise<void> {
  if (input.detail_cost_category_ids.length === 0) return;
  await apiFetch<undefined>('/api/v1/markup/exclusions/batch', {
    method: 'DELETE',
    body: JSON.stringify(input),
  });
}

// ─── tender_pricing_distribution ───────────────────────────────────────────

export async function getTenderPricingDistribution(tenderId: string): Promise<PricingDistribution | null> {
  const res = await apiFetch<{ data: PricingDistribution | null }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/pricing-distribution`,
  );
  return res.data ?? null;
}

export async function upsertTenderPricingDistribution(
  payload: PricingDistributionInsert,
): Promise<PricingDistribution> {
  const res = await apiFetch<{ data: PricingDistribution }>(
    '/api/v1/markup/pricing-distribution',
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.data;
}
