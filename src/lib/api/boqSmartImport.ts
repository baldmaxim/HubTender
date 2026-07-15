// Этап 2.1: клиент «Умного импорта BOQ». Файл анализируется и импортируется
// ТОЛЬКО на сервере; frontend не передаёт normalized rows и не считает деньги.
import { API_BASE_URL } from './featureFlags';
import { getAccessToken } from '../auth/client';

export interface SmartMappingCandidate {
  source_column: string;
  source_header: string;
  score: number;
}

export interface SmartMapping {
  target_field: string;
  label: string;
  source_column?: string;
  source_header?: string;
  confidence: 'high' | 'medium' | 'low' | 'unresolved' | string;
  confidence_percent: number;
  reasons?: string[];
  required: boolean;
  candidates?: SmartMappingCandidate[];
  fixed_value?: string;
  diagnostic_only?: boolean;
}

export interface SmartIssue {
  id: string;
  code: string;
  severity: 'blocker' | 'warning' | 'information' | string;
  sheet: string;
  excel_row: number;
  source_column?: string;
  target_field?: string;
  raw_value?: string;
  normalized_value?: string;
  message: string;
  fix_hint?: string;
}

export interface SmartPreviewRow {
  excel_row: number;
  status: 'ready' | 'warning' | 'blocked' | 'skipped' | string;
  skip_code?: string;
  position_ref?: string;
  boq_item_type?: string;
  description?: string;
  unit_code?: string;
  quantity?: number;
  unit_rate?: number;
  currency_type?: string;
  nomenclature?: string;
  raw?: Record<string, string>;
  transformations?: { field: string; raw: string; normalized: string; code: string; message: string }[];
  issue_ids?: string[];
}

export interface SmartAnalysis {
  workbook_fingerprint: string;
  file_name: string;
  sheets: { name: string; rows_detected: number; columns_detected: number; suggested: boolean; score: number }[];
  selected_sheet: string;
  sheet_confidence: string;
  detected_header_row: number;
  mapping: SmartMapping[];
  detected_formats: { decimal_separator: string; thousands_separator?: string };
  summary: {
    rows_total: number;
    rows_ready: number;
    rows_with_warnings: number;
    rows_blocked: number;
    rows_skipped: number;
    required_mappings_missing: number;
    formula_confirmations_required: number;
  };
  preview_rows: SmartPreviewRow[];
  issues: SmartIssue[];
}

// Этап 2.2: подтверждённый пользователем выбор номенклатуры (§13).
export interface NomenclatureSelectionInput {
  row_reference: string;
  catalog_id: string;
  selection_source: 'exact' | 'ai_confirmed' | 'manual';
}

export interface SmartImportOptions {
  sheet_name?: string;
  header_row?: number;
  mapping?: Record<string, string>;
  accept_formula_cached?: boolean;
  default_currency?: string;
  default_boq_type?: string;
  nomenclature_selections?: NomenclatureSelectionInput[];
}

// Этап 2.2 (§14): provenance номенклатуры в ответе execute.
export interface NomenclatureProvenance {
  exact_nomenclature_matches: number;
  ai_suggestions_confirmed: number;
  manually_selected_nomenclature: number;
  unresolved_nomenclature_rows: number;
  candidate_generation_version: string;
  prompt_version?: string;
}

export interface SmartExecuteResult {
  import: {
    import_session_id: string | null;
    inserted_items_count: number;
    updated_positions_count: number;
    total_mismatch_count: number;
    total_mismatches: unknown[];
  };
  normalization: SmartAnalysis['summary'];
  skipped_rows: number;
  workbook_fingerprint: string;
  nomenclature_provenance: NomenclatureProvenance;
}

// ─── Этап 2.2: AI-подбор номенклатуры (§10) ─────────────────────────────────

export interface SmartAiCandidate {
  id: string;
  label: string;
  type: 'material' | 'work' | string;
  unit: string;
  deterministic_score: number;
  matched_tokens?: string[];
  unmatched_significant_tokens?: string[];
  unit_compatibility: 'exact' | 'unknown' | 'conflict' | string;
  category_compatibility: string;
  retrieval_reasons?: string[];
  significant_token_conflict?: boolean;
}

export interface SmartSuggestionRow {
  row_reference: string;
  excel_row: number;
  source_description: string;
  source_type: string;
  source_unit?: string;
  status: 'suggested' | 'abstain' | 'no_candidates' | 'ai_invalid_response' | 'deterministic_only' | string;
  confidence: 'high' | 'medium' | 'low' | 'abstain' | '' | string;
  selected_candidate_id: string | null;
  explanation?: string;
  abstain_reason?: string;
  matched_features?: string[];
  conflicting_features?: string[];
  candidates: SmartAiCandidate[];
  ai_rank_by_id?: Record<string, number>;
}

export interface SmartSuggestResult {
  workbook_fingerprint: string;
  suggestion_schema_version: number;
  candidate_generation_version: string;
  prompt_version: string;
  provider: {
    status: 'available' | 'disabled' | 'timeout' | 'rate_limited' | 'unavailable' | 'invalid_response' | string;
    provider?: string;
    model?: string;
    rows_requested: number;
    rows_processed: number;
    rows_abstained: number;
  };
  rows: SmartSuggestionRow[];
}

async function postMultipart<T>(path: string, form: FormData): Promise<T> {
  const token = await getAccessToken();
  const resp = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(body?.code ?? body?.detail ?? `HTTP ${resp.status}`) as Error & {
      status?: number; body?: unknown;
    };
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return (body as { data: T }).data;
}

function buildForm(file: File, opts: SmartImportOptions, extra?: Record<string, string>): FormData {
  const form = new FormData();
  form.append('file', file);
  if (opts.sheet_name) form.append('sheet_name', opts.sheet_name);
  if (opts.header_row) form.append('header_row', String(opts.header_row));
  if (opts.mapping && Object.keys(opts.mapping).length > 0) {
    form.append('mapping', JSON.stringify(opts.mapping));
  }
  form.append('confirmed_options', JSON.stringify({
    accept_formula_cached: !!opts.accept_formula_cached,
    default_currency: opts.default_currency ?? '',
    default_boq_type: opts.default_boq_type ?? '',
  }));
  if ((opts.nomenclature_selections?.length ?? 0) > 0) {
    form.append('nomenclature_selections', JSON.stringify(opts.nomenclature_selections));
  }
  for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);
  return form;
}

export async function analyzeBoqImport(tenderId: string, file: File, opts: SmartImportOptions): Promise<SmartAnalysis> {
  return postMultipart(`/api/v1/tenders/${tenderId}/boq-import/analyze`, buildForm(file, opts));
}

export async function executeBoqImport(
  tenderId: string, file: File, fingerprint: string, opts: SmartImportOptions,
): Promise<SmartExecuteResult> {
  return postMultipart(`/api/v1/tenders/${tenderId}/boq-import/execute`,
    buildForm(file, opts, { workbook_fingerprint: fingerprint }));
}

/** Этап 2.2 (§10/§12): подбор номенклатуры для unresolved-строк — ТОЛЬКО по
 *  явному действию пользователя; сервер повторно парсит тот же файл. */
export async function suggestNomenclature(
  tenderId: string, file: File, fingerprint: string, opts: SmartImportOptions,
  rowRefs?: string[],
): Promise<SmartSuggestResult> {
  const extra: Record<string, string> = { workbook_fingerprint: fingerprint };
  if (rowRefs && rowRefs.length > 0) extra.row_references = JSON.stringify(rowRefs);
  return postMultipart(`/api/v1/tenders/${tenderId}/boq-import/suggest-nomenclature`,
    buildForm(file, opts, extra));
}
