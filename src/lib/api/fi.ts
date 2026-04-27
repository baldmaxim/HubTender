// Financial Indicators page helpers — heavy aggregate fetch flow.
// Currently Supabase-only — Go BFF has no fi-domain endpoints yet.

import { supabase } from '../supabase';
import type { Tender, BoqItem, MarkupTactic } from '../supabase';

export type BoqItemWithPosition = BoqItem & {
  client_position: { tender_id: string } | null;
};

export interface TenderInsuranceRow {
  judicial_pct: number;
  total_pct: number;
  apt_price_m2: number;
  apt_area: number;
  parking_price_m2: number;
  parking_area: number;
  storage_price_m2: number;
  storage_area: number;
}

const PAGE = 1000;

export async function getTenderById(id: string): Promise<Tender> {
  const { data, error } = await supabase.from('tenders').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Tender;
}

export async function tryGetMarkupTactic(id: string | null): Promise<MarkupTactic | null> {
  if (!id) return null;
  const { data, error } = await supabase.from('markup_tactics').select('*').eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as MarkupTactic) ?? null;
}

export async function getTenderInsuranceFI(tenderId: string): Promise<TenderInsuranceRow | null> {
  const { data, error } = await supabase
    .from('tender_insurance')
    .select('judicial_pct, total_pct, apt_price_m2, apt_area, parking_price_m2, parking_area, storage_price_m2, storage_area')
    .eq('tender_id', tenderId)
    .maybeSingle();
  if (error) throw error;
  return (data as TenderInsuranceRow) ?? null;
}

export async function listAllBoqItemsForTender(tenderId: string): Promise<BoqItemWithPosition[]> {
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
  const { data, error } = await supabase
    .from('subcontract_growth_exclusions')
    .select('detail_cost_category_id, exclusion_type')
    .eq('tender_id', tenderId);
  if (error) throw error;
  return (data ?? []) as SubcontractGrowthExclusionRow[];
}
