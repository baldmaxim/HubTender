// Tender insurance helpers with Go BFF / Supabase fallback.
// Go path: GET/PUT /api/v1/tenders/:id/insurance.
// Supabase path: direct table read/upsert on public.tender_insurance.

import type { Tender } from '../types';
import { apiFetch } from './client';
import { fetchTenders } from './tenders';

export interface InsuranceData {
  judicial_pct: number;
  total_pct: number;
  apt_price_m2: number;
  apt_area: number;
  parking_price_m2: number;
  parking_area: number;
  storage_price_m2: number;
  storage_area: number;
}

const ZERO_INSURANCE: InsuranceData = {
  judicial_pct: 0,
  total_pct: 0,
  apt_price_m2: 0,
  apt_area: 0,
  parking_price_m2: 0,
  parking_area: 0,
  storage_price_m2: 0,
  storage_area: 0,
};

function toNumber(v: unknown): number {
  return Number(v) || 0;
}

function normalize(data: Partial<InsuranceData>): InsuranceData {
  return {
    judicial_pct: toNumber(data.judicial_pct),
    total_pct: toNumber(data.total_pct),
    apt_price_m2: toNumber(data.apt_price_m2),
    apt_area: toNumber(data.apt_area),
    parking_price_m2: toNumber(data.parking_price_m2),
    parking_area: toNumber(data.parking_area),
    storage_price_m2: toNumber(data.storage_price_m2),
    storage_area: toNumber(data.storage_area),
  };
}

export async function fetchInsuranceTenders(): Promise<Tender[]> {
  // The Insurance admin page only needs a simple tender list — reuse the
  // Go-or-Supabase tenders helper instead of a dedicated endpoint.
  return fetchTenders();
}

export async function loadTenderInsurance(tenderId: string): Promise<InsuranceData | null> {
  const res = await apiFetch<{ data: InsuranceData | null }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/insurance`,
    { cacheKey: `insurance:${tenderId}` },
  );
  return res.data ? normalize(res.data) : null;
}

export async function upsertTenderInsurance(
  tenderId: string,
  data: InsuranceData,
): Promise<void> {
  await apiFetch<{ data: InsuranceData }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/insurance`,
    { method: 'PUT', body: JSON.stringify(data) },
  );
}

export const _DEFAULT_INSURANCE: InsuranceData = ZERO_INSURANCE;
