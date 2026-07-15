// Этап 1.6: клиент «Отчёта для проверки» — JSON preview + авторизованное
// скачивание серверного XLSX (Excel строится ТОЛЬКО на backend).
import { apiFetch } from './client';
import { reviewQueryString } from '../quality/reviewPackPolicy';
import { API_BASE_URL } from './featureFlags';
import { getAccessToken } from '../auth/client';

export interface ReviewSection {
  status: 'available' | 'no_data' | 'baseline_not_available' | 'calculation_not_ready' | 'unavailable' | string;
  note?: string;
}

export interface ReviewMetadata {
  report_schema_version: number;
  tender_id: string;
  tender_number: string;
  tender_version: number;
  tender_label: string;
  financial_input_revision: number;
  financial_calculation_revision: number;
  financial_calculation_status: string;
  financial_approved: boolean;
  approved_by_label?: string;
  approved_at?: string;
  generated_at: string;
  as_of_date: string;
  benchmark_period_months: number;
  source_max_age_days: number;
  baseline_tender_id?: string;
  baseline_version?: number;
  calculation_source: string;
  cached_grand_total: number;
  report_fingerprint: string;
}

export interface ReviewExecutiveSummary {
  headline: string;
  quality: {
    blockers: number; warnings: number; information: number;
    calculation_completeness_percent: number; review_completeness_percent: number;
    boq_items_with_issues: number;
  };
  action_plan: {
    blocking_actions: number; high_actions: number; normal_actions: number;
    low_actions: number; affected_boq_items: number;
    amount_requiring_review: number | null;
  };
  price_benchmark: {
    eligible_items: number; benchmarked_items: number; high_outliers: number;
    low_outliers: number; insufficient_history: number; within_range: number;
    coverage_percent: number;
  };
  price_source: {
    source_coverage_percent: number; current_source_coverage_percent: number;
    stale_items: number; expired_items: number; missing_source_items: number;
    missing_price_date_items: number; fresh_items: number;
    amount_requiring_review: number | null;
  };
  change_impact: {
    baseline_version?: number; grand_total_delta: number; direct_total_delta: number;
    commercial_material_delta: number; commercial_work_delta: number;
    insurance_delta: number; items_added: number; items_removed: number;
    items_modified: number; reconciliation_status?: string;
  };
}

export interface ReviewReport {
  status: 'ready' | 'calculation_not_ready' | string;
  metadata: ReviewMetadata;
  components: {
    quality: ReviewSection;
    action_plan: ReviewSection;
    price_benchmark: ReviewSection;
    price_source: ReviewSection;
    change_impact: ReviewSection;
  };
  executive_summary: ReviewExecutiveSummary;
  download_url: string;
}

export interface ReviewQuery {
  benchmark_period_months?: number;
  source_max_age_days?: number;
  baseline_tender_id?: string;
}

export { reviewQueryString } from '../quality/reviewPackPolicy';

export async function fetchReviewReport(tenderId: string, q: ReviewQuery = {}): Promise<ReviewReport> {
  const qs = reviewQueryString(q);
  const resp = await apiFetch<{ data: ReviewReport }>(
    `/api/v1/tenders/${tenderId}/review-report${qs ? `?${qs}` : ''}`,
    { timeoutMs: 60_000 },
  );
  return resp.data;
}

/** Авторизованное скачивание XLSX: Bearer-токен + blob → сохранение файла.
 *  Никакой клиентской генерации Excel. */
export async function downloadReviewReportXlsx(tenderId: string, q: ReviewQuery = {}): Promise<void> {
  const qs = reviewQueryString(q);
  const url = `${API_BASE_URL}/api/v1/tenders/${tenderId}/review-report.xlsx${qs ? `?${qs}` : ''}`;
  const token = await getAccessToken();
  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    let code = '';
    try {
      const body = await resp.json();
      code = body?.code ?? body?.detail ?? '';
    } catch { /* тело не JSON */ }
    const err = new Error(code || `Скачивание не удалось (HTTP ${resp.status})`) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
  const blob = await resp.blob();
  const disposition = resp.headers.get('Content-Disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : 'review-report.xlsx';
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
