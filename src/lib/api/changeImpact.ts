// Этап 1.5: клиент GET /api/v1/tenders/{id}/change-impact (read-only
// сравнение сохранённых версий; никаких мутаций/recalc/rollback).
import { apiFetch } from './client';

export type ChangeStatus = 'UNCHANGED' | 'MODIFIED' | 'ADDED' | 'REMOVED' | 'AMBIGUOUS_GROUP' | string;

export interface MoneyPair {
  baseline: number;
  current: number;
  delta: number;
}

export interface FieldChange {
  field: string;
  label: string;
  old_value: string;
  new_value: string;
  evidence_only?: boolean;
}

export interface DiffItem {
  id: string;
  status: ChangeStatus;
  boq_item_type: string;
  label: string;
  position_label: string;
  client_position_id: string | null;
  current_item_id: string | null;
  baseline_item_id: string | null;
  current_item_ids?: string[];
  baseline_item_ids?: string[];
  current_count?: number;
  baseline_count?: number;
  changed_fields?: FieldChange[];
  quantity?: MoneyPair;
  unit_rate?: MoneyPair;
  direct: MoneyPair;
  commercial: MoneyPair;
  direction: 'increase' | 'decrease' | 'unchanged' | string;
  note?: string;
}

export interface BridgeEntry {
  code: string;
  label: string;
  amount: number;
}

export interface ConfigChange {
  code: string;
  label: string;
  old_value: string;
  new_value: string;
  changed: boolean;
  navigation: string;
}

export interface PositionSummaryRow {
  position_key: string;
  position_label: string;
  current_position_id: string | null;
  baseline_position_id: string | null;
  status: string;
  direct: MoneyPair;
  commercial: MoneyPair;
  items_added: number;
  items_removed: number;
  items_modified: number;
  ambiguous_groups: number;
}

export interface ContributorRow {
  type: string;
  id: string;
  label: string;
  position_label?: string;
  baseline: number;
  current: number;
  delta: number;
  direct_delta?: number;
  direction: string;
  changed_fields?: string[];
  current_item_id?: string;
  client_position_id?: string;
}

export interface ChangeImpactSummary {
  baseline_grand_total: number;
  current_grand_total: number;
  grand_total_delta: number;
  direct_total_delta: number;
  commercial_material_delta: number;
  commercial_work_delta: number;
  boq_commercial_delta: number;
  insurance_delta: number;
  reconciled_total_delta: number;
  positions_changed: number;
  items_added: number;
  items_removed: number;
  items_modified: number;
  items_unchanged: number;
  ambiguous_groups: number;
  is_reconciled: boolean;
  reconciliation_residual: number;
  reconciliation_status: string;
}

export interface VersionMeta {
  tender_id: string;
  tender_number: string;
  version: number;
  approved_at?: string;
  financial_input_revision: number;
  cached_grand_total: number;
}

export interface BaselineCandidate {
  tender_id: string;
  version: number;
  approved_at: string;
  cached_grand_total: number;
  label: string;
}

export interface ChangeImpactReport {
  status: 'OK' | 'BASELINE_NOT_AVAILABLE' | string;
  current: VersionMeta;
  baseline: VersionMeta | null;
  baseline_candidates: BaselineCandidate[];
  generated_at: string;
  summary: ChangeImpactSummary;
  filtered_summary: {
    filtered_items: number;
    filtered_commercial_delta: number;
    filtered_direct_delta: number;
  };
  bridge: BridgeEntry[];
  configuration_changes: ConfigChange[];
  position_summaries: PositionSummaryRow[];
  top_contributors: ContributorRow[];
  items: DiffItem[];
  pagination: { page: number; page_size: number; total: number };
}

export interface ChangeImpactQuery {
  baseline_tender_id?: string;
  status?: string;
  position_id?: string;
  boq_item_type?: string;
  search?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}

export async function fetchChangeImpact(tenderId: string, q: ChangeImpactQuery = {}): Promise<ChangeImpactReport> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  const resp = await apiFetch<{ data: ChangeImpactReport }>(
    `/api/v1/tenders/${tenderId}/change-impact${qs ? `?${qs}` : ''}`,
  );
  return resp.data;
}
