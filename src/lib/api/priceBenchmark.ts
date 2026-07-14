// Этап 1.2: клиент GET /api/v1/tenders/{id}/price-benchmarks (read-only).
import { apiFetch } from './client';

export type BenchmarkStatus =
  | 'HIGH_OUTLIER' | 'LOW_OUTLIER' | 'WITHIN_RANGE'
  | 'INSUFFICIENT_HISTORY' | 'NOT_ELIGIBLE';

export interface BenchmarkItem {
  boq_item_id: string;
  client_position_id: string;
  boq_item_type: string;
  name: string;
  unit_code: string;
  quantity: number;
  current_unit_cost: number;
  status: BenchmarkStatus | string;
  not_eligible_reason?: string;
  historical_tenders_count: number;
  historical_rows_count: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  lower_fence: number | null;
  upper_fence: number | null;
  minimum: number | null;
  maximum: number | null;
  deviation_from_median_percent: number | null;
  earliest_observation_at?: string;
  latest_observation_at?: string;
  message: string;
  review_hint?: string;
}

export interface BenchmarkSummary {
  eligible_items: number;
  benchmarked_items: number;
  high_outliers: number;
  low_outliers: number;
  within_range: number;
  insufficient_history: number;
  not_eligible: number;
  coverage_percent: number;
}

export interface BenchmarkReport {
  tender_id: string;
  financial_input_revision: number;
  financial_calculation_revision: number;
  financial_calculation_status: string;
  period_months: number;
  generated_at: string;
  summary: BenchmarkSummary;
  items: BenchmarkItem[];
  pagination: { page: number; page_size: number; total: number };
}

export interface BenchmarkObservation {
  tender_id?: string;
  tender_label: string;
  version: number;
  approved_at: string;
  representative_unit_cost: number;
  matched_rows_count: number;
  quantity_sum: number;
}

export interface BenchmarkHistoryDetail {
  item: BenchmarkItem;
  observations: BenchmarkObservation[];
  methodology: string;
}

export interface BenchmarkQuery {
  period_months?: number;
  status?: string;
  position_id?: string;
  boq_item_type?: string;
  search?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}

export async function fetchPriceBenchmarks(tenderId: string, q: BenchmarkQuery = {}): Promise<BenchmarkReport> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  const resp = await apiFetch<{ data: BenchmarkReport }>(
    `/api/v1/tenders/${tenderId}/price-benchmarks${qs ? `?${qs}` : ''}`,
  );
  return resp.data;
}

export async function fetchBenchmarkHistory(
  tenderId: string, boqItemId: string, periodMonths: number,
): Promise<BenchmarkHistoryDetail> {
  const resp = await apiFetch<{ data: BenchmarkHistoryDetail }>(
    `/api/v1/tenders/${tenderId}/price-benchmarks/${boqItemId}/history?period_months=${periodMonths}&limit=50`,
  );
  return resp.data;
}
