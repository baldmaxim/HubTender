// Markup tactics + parameters + tender markup percentages + pricing distribution
// + subcontract growth exclusions, with Go BFF / Supabase fallback.

import { supabase } from '../supabase';
import type {
  MarkupParameter,
  MarkupTactic,
  PricingDistribution,
  PricingDistributionInsert,
  TenderMarkupPercentageInsert,
} from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

// ─── markup_tactics ─────────────────────────────────────────────────────────

export async function listMarkupTactics(): Promise<MarkupTactic[]> {
  if (isGoEnabled('markup')) {
    const res = await apiFetch<{ data: MarkupTactic[] }>('/api/v1/markup/tactics', {
      cacheKey: 'markup:tactics',
    });
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('markup_tactics')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MarkupTactic[];
}

export async function getMarkupTactic(id: string): Promise<MarkupTactic | null> {
  if (isGoEnabled('markup')) {
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
  const { data, error } = await supabase
    .from('markup_tactics')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return (data as MarkupTactic) ?? null;
}

export async function findGlobalMarkupTacticByName(name: string): Promise<MarkupTactic | null> {
  if (isGoEnabled('markup')) {
    const res = await apiFetch<{ data: MarkupTactic | null }>(
      `/api/v1/markup/tactics/global-by-name?name=${encodeURIComponent(name)}`,
    );
    return res.data ?? null;
  }
  const { data, error } = await supabase
    .from('markup_tactics')
    .select('*')
    .eq('name', name)
    .eq('is_global', true)
    .maybeSingle();
  if (error) throw error;
  return (data as MarkupTactic) ?? null;
}

export interface MarkupTacticInput {
  name: string;
  sequences: Record<string, unknown>;
  base_costs: Record<string, number>;
  is_global?: boolean;
}

export async function createMarkupTactic(input: MarkupTacticInput): Promise<MarkupTactic> {
  if (isGoEnabled('markup')) {
    const res = await apiFetch<{ data: MarkupTactic }>('/api/v1/markup/tactics', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.data;
  }
  const { data, error } = await supabase
    .from('markup_tactics')
    .insert({
      name: input.name,
      sequences: input.sequences,
      base_costs: input.base_costs,
      is_global: input.is_global ?? false,
    })
    .select()
    .single();
  if (error) throw error;
  return data as MarkupTactic;
}

export async function updateMarkupTactic(id: string, input: Partial<MarkupTacticInput>): Promise<MarkupTactic> {
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>(`/api/v1/markup/tactics/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    const fresh = await getMarkupTactic(id);
    if (!fresh) throw new Error('updateMarkupTactic: tactic disappeared after update');
    return fresh;
  }
  const { data, error } = await supabase
    .from('markup_tactics')
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.sequences !== undefined ? { sequences: input.sequences } : {}),
      ...(input.base_costs !== undefined ? { base_costs: input.base_costs } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as MarkupTactic;
}

export async function renameMarkupTactic(id: string, name: string): Promise<void> {
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>(`/api/v1/markup/tactics/${encodeURIComponent(id)}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    return;
  }
  const { error } = await supabase.from('markup_tactics').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function deleteMarkupTactic(id: string): Promise<void> {
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>(`/api/v1/markup/tactics/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return;
  }
  const { error } = await supabase.from('markup_tactics').delete().eq('id', id);
  if (error) throw error;
}

// ─── markup_parameters ─────────────────────────────────────────────────────

export async function listActiveMarkupParameters(): Promise<MarkupParameter[]> {
  if (isGoEnabled('markup')) {
    const res = await apiFetch<{ data: MarkupParameter[] }>('/api/v1/markup/parameters', {
      cacheKey: 'markup:parameters',
    });
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('markup_parameters')
    .select('*')
    .eq('is_active', true)
    .order('order_num', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MarkupParameter[];
}

export interface MarkupParameterInput {
  key: string;
  label: string;
  is_active?: boolean;
  order_num?: number;
  default_value?: number;
}

export async function createMarkupParameter(input: MarkupParameterInput): Promise<void> {
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>('/api/v1/markup/parameters', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return;
  }
  const { error } = await supabase.from('markup_parameters').insert({
    key: input.key,
    label: input.label,
    is_active: input.is_active ?? true,
    order_num: input.order_num,
    default_value: input.default_value,
  });
  if (error) throw error;
}

export async function updateMarkupParameter(
  id: string,
  patch: Partial<Pick<MarkupParameter, 'label' | 'default_value' | 'order_num' | 'is_active'>>,
): Promise<void> {
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>(`/api/v1/markup/parameters/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return;
  }
  const { error } = await supabase
    .from('markup_parameters')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteMarkupParameter(id: string): Promise<void> {
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>(`/api/v1/markup/parameters/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return;
  }
  const { error } = await supabase.from('markup_parameters').delete().eq('id', id);
  if (error) throw error;
}

export async function setMarkupParameterOrderNum(id: string, orderNum: number): Promise<void> {
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>(`/api/v1/markup/parameters/${encodeURIComponent(id)}/order-num`, {
      method: 'PATCH',
      body: JSON.stringify({ order_num: orderNum }),
    });
    return;
  }
  const { error } = await supabase.from('markup_parameters').update({ order_num: orderNum }).eq('id', id);
  if (error) throw error;
}

// ─── tender markup tactic linkage ───────────────────────────────────────────

export async function getTenderMarkupTacticId(tenderId: string): Promise<string | null> {
  if (isGoEnabled('markup')) {
    const res = await apiFetch<{ markup_tactic_id: string | null }>(
      `/api/v1/tenders/${encodeURIComponent(tenderId)}/markup/tactic-id`,
    );
    return res.markup_tactic_id ?? null;
  }
  const { data, error } = await supabase
    .from('tenders')
    .select('markup_tactic_id')
    .eq('id', tenderId)
    .single();
  if (error) throw error;
  return data?.markup_tactic_id ?? null;
}

export async function setTenderMarkupTacticId(tenderId: string, tacticId: string): Promise<void> {
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>(
      `/api/v1/tenders/${encodeURIComponent(tenderId)}/markup/tactic-id`,
      { method: 'PUT', body: JSON.stringify({ markup_tactic_id: tacticId }) },
    );
    return;
  }
  const { error } = await supabase.from('tenders').update({ markup_tactic_id: tacticId }).eq('id', tenderId);
  if (error) throw error;
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
  if (isGoEnabled('markup')) {
    const res = await apiFetch<{ data: TenderMarkupPercentageRow[] }>(
      `/api/v1/tenders/${encodeURIComponent(tenderId)}/markup/percentages`,
    );
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('tender_markup_percentage')
    .select('*, markup_parameter:markup_parameters(*)')
    .eq('tender_id', tenderId);
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as TenderMarkupPercentageRow & { markup_parameter: MarkupParameter | MarkupParameter[] | null };
    const mp = Array.isArray(r.markup_parameter) ? r.markup_parameter[0] ?? null : r.markup_parameter;
    return { ...r, markup_parameter: mp };
  });
}

export async function deleteTenderMarkupPercentages(tenderId: string): Promise<void> {
  // Replace flow on Go path is atomic via insertTenderMarkupPercentages; on
  // Supabase the page calls delete + insert separately (legacy), preserve.
  if (isGoEnabled('markup')) return;
  const { error } = await supabase.from('tender_markup_percentage').delete().eq('tender_id', tenderId);
  if (error) throw error;
}

export async function insertTenderMarkupPercentages(records: TenderMarkupPercentageInsert[]): Promise<void> {
  if (records.length === 0) return;

  if (isGoEnabled('markup')) {
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
    return;
  }

  const { error } = await supabase.from('tender_markup_percentage').insert(records);
  if (error) throw error;
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
  if (isGoEnabled('markup')) {
    const res = await apiFetch<{ data: SubcontractExclusionRow[] }>(
      `/api/v1/tenders/${encodeURIComponent(tenderId)}/markup/exclusions`,
    );
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('subcontract_growth_exclusions')
    .select('detail_cost_category_id, exclusion_type')
    .eq('tender_id', tenderId);
  if (error) throw error;
  return (data ?? []) as SubcontractExclusionRow[];
}

export async function insertSubcontractGrowthExclusion(input: {
  tender_id: string;
  detail_cost_category_id: string;
  exclusion_type: SubcontractExclusionType;
}): Promise<void> {
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>('/api/v1/markup/exclusions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return;
  }
  const { error } = await supabase.from('subcontract_growth_exclusions').insert(input);
  if (error) throw error;
}

export async function insertSubcontractGrowthExclusionsBatch(rows: Array<{
  tender_id: string;
  detail_cost_category_id: string;
  exclusion_type: SubcontractExclusionType;
}>): Promise<void> {
  if (rows.length === 0) return;
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>('/api/v1/markup/exclusions/batch', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
    return;
  }
  const { error } = await supabase.from('subcontract_growth_exclusions').insert(rows);
  if (error) throw error;
}

export async function deleteSubcontractGrowthExclusion(input: {
  tender_id: string;
  detail_cost_category_id: string;
  exclusion_type: SubcontractExclusionType;
}): Promise<void> {
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>('/api/v1/markup/exclusions', {
      method: 'DELETE',
      body: JSON.stringify(input),
    });
    return;
  }
  const { error } = await supabase
    .from('subcontract_growth_exclusions')
    .delete()
    .eq('tender_id', input.tender_id)
    .eq('detail_cost_category_id', input.detail_cost_category_id)
    .eq('exclusion_type', input.exclusion_type);
  if (error) throw error;
}

export async function deleteSubcontractGrowthExclusionsBatch(input: {
  tender_id: string;
  detail_cost_category_ids: string[];
  exclusion_type: SubcontractExclusionType;
}): Promise<void> {
  if (input.detail_cost_category_ids.length === 0) return;
  if (isGoEnabled('markup')) {
    await apiFetch<undefined>('/api/v1/markup/exclusions/batch', {
      method: 'DELETE',
      body: JSON.stringify(input),
    });
    return;
  }
  const { error } = await supabase
    .from('subcontract_growth_exclusions')
    .delete()
    .eq('tender_id', input.tender_id)
    .in('detail_cost_category_id', input.detail_cost_category_ids)
    .eq('exclusion_type', input.exclusion_type);
  if (error) throw error;
}

// ─── tender_pricing_distribution ───────────────────────────────────────────

export async function getTenderPricingDistribution(tenderId: string): Promise<PricingDistribution | null> {
  if (isGoEnabled('markup')) {
    const res = await apiFetch<{ data: PricingDistribution | null }>(
      `/api/v1/tenders/${encodeURIComponent(tenderId)}/pricing-distribution`,
    );
    return res.data ?? null;
  }
  const { data, error } = await supabase
    .from('tender_pricing_distribution')
    .select('*')
    .eq('tender_id', tenderId)
    .maybeSingle();
  if (error) throw error;
  return (data as PricingDistribution) ?? null;
}

export async function upsertTenderPricingDistribution(
  payload: PricingDistributionInsert,
): Promise<PricingDistribution> {
  if (isGoEnabled('markup')) {
    const res = await apiFetch<{ data: PricingDistribution }>(
      '/api/v1/markup/pricing-distribution',
      { method: 'POST', body: JSON.stringify(payload) },
    );
    return res.data;
  }
  const { data, error } = await supabase
    .from('tender_pricing_distribution')
    .upsert(payload, { onConflict: 'tender_id,markup_tactic_id' })
    .select()
    .single();
  if (error) throw error;
  return data as PricingDistribution;
}
