// Financial Indicators page helpers with Go BFF / Supabase fallback.

import { supabase } from '../supabase';
import type { Tender, BoqItem, MarkupTactic } from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';
import { getMarkupTactic } from './markup';
import { loadTenderInsurance, type InsuranceData } from './insurance';

export type BoqItemWithPosition = BoqItem & {
  client_position: { tender_id: string } | null;
};

export interface TenderInsuranceRow extends InsuranceData {}

const PAGE = 1000;

export async function getTenderById(id: string): Promise<Tender> {
  if (isGoEnabled('fi')) {
    const res = await apiFetch<{ data: Tender }>(`/api/v1/tenders/${encodeURIComponent(id)}`);
    return res.data;
  }
  const { data, error } = await supabase.from('tenders').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Tender;
}

export async function tryGetMarkupTactic(id: string | null): Promise<MarkupTactic | null> {
  if (!id) return null;
  // Reuse the markup api helper — it already handles Go/Supabase + 404.
  return getMarkupTactic(id);
}

export async function getTenderInsuranceFI(tenderId: string): Promise<TenderInsuranceRow | null> {
  // Reuse the insurance api helper to keep one Go/Supabase branch.
  return loadTenderInsurance(tenderId);
}

export async function listAllBoqItemsForTender(tenderId: string): Promise<BoqItemWithPosition[]> {
  if (isGoEnabled('fi')) {
    const res = await apiFetch<{ data: BoqItemWithPosition[] }>(
      `/api/v1/tenders/${encodeURIComponent(tenderId)}/boq-items-flat`,
    );
    return res.data ?? [];
  }
  const all: BoqItemWithPosition[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('boq_items')
      .select('*, client_position:client_positions!inner(tender_id)')
      .eq('client_position.tender_id', tenderId)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as BoqItemWithPosition[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export interface SubcontractGrowthExclusionRow {
  detail_cost_category_id: string;
  exclusion_type: 'works' | 'materials';
}

export async function listSubcontractGrowthExclusions(
  tenderId: string,
): Promise<SubcontractGrowthExclusionRow[]> {
  // Reuse the markup api helper which already has the Go branch.
  const { listSubcontractGrowthExclusionsForTender } = await import('./markup');
  const rows = await listSubcontractGrowthExclusionsForTender(tenderId);
  return rows as SubcontractGrowthExclusionRow[];
}
