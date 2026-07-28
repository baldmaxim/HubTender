// Этап 1.1: клиент GET /api/v1/tenders/{id}/quality-analytics (read-only аналитика этапа 2.1; путь /quality занят «Проверкой данных»).
import { apiFetch } from './client';

export type QualitySeverity = 'blocker' | 'warning' | 'information';

export interface QualityIssue {
  id: string;
  code: string;
  severity: QualitySeverity | string;
  category: string;
  entity_type: 'tender' | 'client_position' | 'boq_item' | string;
  entity_id: string;
  client_position_id?: string;
  field?: string;
  title: string;
  message: string;
  fix_hint: string;
  current_value: string | null;
  affected_item_ids?: string[];
  affected_count?: number;
  group_total_amount?: number;
}

export interface QualityCategorySummary {
  code: string;
  blockers: number;
  warnings: number;
  information: number;
}

export interface QualitySummary {
  blockers: number;
  warnings: number;
  information: number;
  calculation_completeness_percent: number;
  review_completeness_percent: number;
  positions_total: number;
  boq_items_total: number;
  boq_items_with_issues: number;
}

export interface QualityReport {
  tender_id: string;
  financial_input_revision: number;
  financial_calculation_revision: number;
  financial_calculation_status: string;
  generated_at: string;
  summary: QualitySummary;
  categories: QualityCategorySummary[];
  issues: QualityIssue[];
}

export async function fetchTenderQuality(tenderId: string): Promise<QualityReport> {
  const resp = await apiFetch<{ data: QualityReport }>(
    `/api/v1/tenders/${tenderId}/quality-analytics`,
  );
  return resp.data;
}
