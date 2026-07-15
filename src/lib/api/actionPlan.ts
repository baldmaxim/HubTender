// Этап 1.4: клиент GET /api/v1/tenders/{id}/action-plan (read-only; никаких
// mutation endpoints для действий — план динамический, не task-система).
import { apiFetch } from './client';

export type ActionPriority = 'blocking' | 'high' | 'normal' | 'low' | string;

export interface ActionNavigation {
  type: string; // boq_item | tender_currency | financial_indicators | redistribution | duplicate_group | analytics_page
  position_id: string | null;
  item_id: string | null;
  field?: string;
}

export interface ActionSourceNavigation {
  analytics_page: string; // quality | price_benchmark | price_source
  item_id?: string;
}

export interface PlanAction {
  id: string;
  rank: number;
  priority: ActionPriority;
  source: string;
  sources: string[];
  code: string;
  category: string;
  entity_type: string;
  entity_id: string;
  client_position_id: string | null;
  boq_item_ids?: string[];
  field?: string;
  title: string;
  reason: string;
  recommended_action: string;
  priority_reason: string;
  affected_items_count: number;
  impact_amount: number | null;
  impact_amount_status: 'available' | 'unavailable' | string;
  navigation: ActionNavigation;
  source_navigation: ActionSourceNavigation;
  evidence?: Record<string, string>;
}

export interface PlanComponent {
  status: 'available' | 'calculation_not_ready' | 'no_history' | 'unavailable' | string;
  items_considered?: number;
  period_months?: number;
  max_age_days?: number;
  note?: string;
}

export interface PlanSummary {
  actions_total: number;
  blocking_actions: number;
  high_actions: number;
  normal_actions: number;
  low_actions: number;
  affected_boq_items: number;
  affected_positions: number;
  amount_metrics_status: 'available' | 'unavailable' | string;
  amount_requiring_review: number | null;
  actions_by_source: Record<string, number>;
  price_items_within_range: number;
  price_items_insufficient_history: number;
  price_sources_fresh: number;
  price_sources_not_applicable: number;
}

export interface ActionPlanReport {
  tender_id: string;
  financial_input_revision: number;
  financial_calculation_revision: number;
  financial_calculation_status: string;
  generated_at: string;
  as_of_date: string;
  benchmark_period_months: number;
  source_max_age_days: number;
  components: {
    quality: PlanComponent;
    price_benchmark: PlanComponent;
    price_source: PlanComponent;
  };
  summary: PlanSummary;
  actions: PlanAction[];
  pagination: { page: number; page_size: number; total: number };
}

export interface ActionPlanQuery {
  benchmark_period_months?: number;
  source_max_age_days?: number;
  priority?: string;
  source?: string;
  category?: string;
  position_id?: string;
  search?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}

export async function fetchActionPlan(tenderId: string, q: ActionPlanQuery = {}): Promise<ActionPlanReport> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  const resp = await apiFetch<{ data: ActionPlanReport }>(
    `/api/v1/tenders/${tenderId}/action-plan${qs ? `?${qs}` : ''}`,
  );
  return resp.data;
}
