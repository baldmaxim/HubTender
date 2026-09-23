import { apiFetch } from './client';

export interface PricingDraftSummary {
  id: string;
  tender_id: string;
  created_by: string;
  status: 'draft' | 'ready' | 'applied' | 'cancelled' | 'stale';
  validation_hash?: string;
  summary: Record<string, unknown>;
  expires_at: string;
  applied_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PricingDraftOperation {
  id: string;
  action: 'create_item' | 'update_item';
  target_position_id: string;
  target_item_id?: string;
  source_kind: 'archive' | 'library' | 'template' | 'manual';
  source_ref: Record<string, unknown>;
  match_level: string;
  confidence: number;
  rationale?: string;
  warnings: string[];
  proposed_payload: Record<string, unknown>;
}

export interface PricingDraft extends PricingDraftSummary {
  operations: PricingDraftOperation[];
  events: Array<{ event_type: string; actor_id: string; details: Record<string, unknown>; created_at: string }>;
}

export interface ValidationSummary {
  draft_id: string;
  status: string;
  validation_hash: string;
  operations_count: number;
  create_count: number;
  update_count: number;
  warnings_count: number;
  blocking_errors: string[];
  before_direct_total: number;
  after_direct_total: number;
  delta_direct_total: number;
  unresolved_positions: number;
  validated_at: string;
}

export interface QAReport {
  tender_id: string;
  position_count: number;
  leaf_position_count: number;
  unpriced_position_count: number;
  item_count: number;
  missing_rate_count: number;
  missing_quantity_count: number;
  missing_category_count: number;
  missing_fx_currencies: string[];
  weak_source_count: number;
  stale_source_count: number;
  items_without_provenance: number;
  direct_total: number;
  ready_for_review: boolean;
  blocking_issues: string[];
  generated_at: string;
}

interface DataEnvelope<T> { data: T }
interface DraftListEnvelope { data: PricingDraftSummary[]; pagination: { total_count: number; has_more: boolean; next_offset?: number } }

export async function listPricingDrafts(tenderId: string): Promise<DraftListEnvelope> {
  return apiFetch<DraftListEnvelope>(`/api/v1/pricing/drafts?tender_id=${encodeURIComponent(tenderId)}&limit=100`);
}

export async function getPricingDraft(id: string): Promise<PricingDraft> {
  return (await apiFetch<DataEnvelope<PricingDraft>>(`/api/v1/pricing/drafts/${encodeURIComponent(id)}`)).data;
}

export async function validatePricingDraft(id: string): Promise<ValidationSummary> {
  return (await apiFetch<DataEnvelope<ValidationSummary>>(`/api/v1/pricing/drafts/${encodeURIComponent(id)}/validate`, { method: 'POST' })).data;
}

export async function applyPricingDraft(id: string, validationHash: string): Promise<void> {
  await apiFetch(`/api/v1/pricing/drafts/${encodeURIComponent(id)}/apply`, {
    method: 'POST', body: JSON.stringify({ validation_hash: validationHash, confirm: true }), timeoutMs: 0,
  });
}

export async function cancelPricingDraft(id: string): Promise<void> {
  await apiFetch(`/api/v1/pricing/drafts/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

export async function getPricingQA(tenderId: string): Promise<QAReport> {
  return (await apiFetch<DataEnvelope<QAReport>>(`/api/v1/tenders/${encodeURIComponent(tenderId)}/pricing-qa`)).data;
}

