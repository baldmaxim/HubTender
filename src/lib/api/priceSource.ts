// Этап 1.3: клиент GET /api/v1/tenders/{id}/price-source-quality (read-only).
import { apiFetch } from './client';

export type SourceStatus =
  | 'FRESH' | 'EXPIRING_SOON' | 'STALE' | 'EXPIRED'
  | 'SOURCE_MISSING' | 'PRICE_DATE_MISSING' | 'INVALID_SOURCE_DATES' | 'NOT_APPLICABLE';

export interface SourceRow {
  boq_item_id: string;
  client_position_id: string;
  boq_item_type: string;
  name: string;
  unit_code: string;
  unit_rate: number | null;
  total_amount: number | null;
  status: SourceStatus | string;
  severity: 'warning' | 'information' | 'none' | string;
  source_label?: string;
  source_url: string | null;
  price_date: string | null;
  valid_until: string | null;
  age_days: number | null;
  days_until_expiry: number | null;
  message: string;
  review_hint?: string;
}

export interface SourceSummary {
  price_bearing_items_total: number;
  items_with_source: number;
  fresh_items: number;
  expiring_soon_items: number;
  stale_items: number;
  expired_items: number;
  missing_source_items: number;
  missing_price_date_items: number;
  invalid_date_items: number;
  distinct_sources_count: number;
  source_coverage_percent: number;
  current_source_coverage_percent: number;
  price_bearing_direct_amount: number | null;
  amount_with_source: number | null;
  current_source_amount: number | null;
  amount_requiring_review: number | null;
  expiring_soon_amount: number | null;
  source_amount_coverage_percent: number | null;
  current_source_amount_coverage_percent: number | null;
}

export interface SourceReport {
  tender_id: string;
  financial_input_revision: number;
  financial_calculation_revision: number;
  financial_calculation_status: string;
  generated_at: string;
  as_of_date: string;
  max_age_days: number;
  expiring_soon_days: number;
  amount_metrics_status: 'available' | 'unavailable' | string;
  amount_metrics_note?: string;
  summary: SourceSummary;
  items: SourceRow[];
  pagination: { page: number; page_size: number; total: number };
}

export interface SourceQuery {
  max_age_days?: number;
  status?: string;
  position_id?: string;
  boq_item_type?: string;
  search?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}

export async function fetchPriceSourceQuality(tenderId: string, q: SourceQuery = {}): Promise<SourceReport> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  const resp = await apiFetch<{ data: SourceReport }>(
    `/api/v1/tenders/${tenderId}/price-source-quality${qs ? `?${qs}` : ''}`,
  );
  return resp.data;
}

/** Metadata-only PATCH источника (не двигает ревизию/approval — этап 1.3). */
export async function updateBoqQuoteSource(
  itemId: string,
  patch: { quote_link?: string; quote_price_date?: string; quote_valid_until?: string },
): Promise<void> {
  await apiFetch(`/api/v1/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
