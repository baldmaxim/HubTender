// Financial Indicators page helpers with Go BFF / Supabase fallback.

import type { Tender, BoqItem, MarkupTactic } from '../supabase';
import { apiFetch } from './client';
import { getMarkupTactic } from './markup';
import { loadTenderInsurance, type InsuranceData } from './insurance';

export type BoqItemWithPosition = BoqItem & {
  client_position: { tender_id: string } | null;
};

export interface TenderInsuranceRow extends InsuranceData {}

export async function getTenderById(id: string): Promise<Tender> {
  const res = await apiFetch<{ data: Tender }>(`/api/v1/tenders/${encodeURIComponent(id)}`);
  return res.data;
}

/**
 * Согласовать «Финансовые показатели» версии тендера (только Генеральный
 * директор; роль проверяется на бэкенде). Необратимо.
 * Go path: POST /api/v1/tenders/:id/financial-approval.
 */
export async function approveFinancial(tenderId: string): Promise<void> {
  await apiFetch<undefined>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/financial-approval`,
    { method: 'POST' },
  );
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
  const res = await apiFetch<{ data: BoqItemWithPosition[] }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/boq-items-flat`,
  );
  return res.data ?? [];
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
