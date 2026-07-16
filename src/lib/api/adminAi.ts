// Этап 2.5: AI-администрирование OpenRouter (admin-only) + user capability.
//
// Границы:
//   - API key НИКОГДА не проходит через frontend: сервер отдаёт только
//     api_key_configured; поля ввода ключа в UI нет;
//   - model ID выбирается ТОЛЬКО из server-returned каталога; free-text
//     ввода модели нет;
//   - endpoint/prompt/policy из frontend не передаются.
import { apiFetch } from './client';

// ── Типы (зеркала backend views) ─────────────────────────────────────────────

export interface AiKeyStatus {
  label: string;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: string | null;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  byok_usage: number;
  is_free_tier: boolean;
  expires_at: string | null;
}

export interface AiConnectionView {
  api_key_configured: boolean;
  connection:
    | 'connected'
    | 'not_configured'
    | 'unauthorized'
    | 'payment_required'
    | 'rate_limited'
    | 'unavailable';
  key?: AiKeyStatus | null;
  checked_at?: string | null;
  base_host: string;
}

export interface AiCatalogModel {
  id: string;
  canonical_slug: string;
  name: string;
  description: string;
  created_at: string;
  expiration_date: string | null;
  context_length: number | null;
  max_completion_tokens: number | null;
  input_modalities: string[];
  output_modalities: string[];
  modality: string;
  tokenizer: string;
  prompt_price_per_token: string;
  completion_price_per_token: string;
  request_price: string;
  price_per_1m_input_tokens: string;
  price_per_1m_output_tokens: string;
  supported_parameters: string[];
  is_moderated: boolean;
  structured_outputs_indicated: boolean;
  is_free_variant: boolean;
  author: string;
}

export interface AiCatalogView {
  models: AiCatalogModel[] | null;
  status: 'fresh' | 'stale' | 'unavailable';
  fetched_at: string | null;
  expires_at: string | null;
  last_error_code?: string;
  total_count: number;
}

export interface AiTestView {
  status: 'required' | 'passed' | 'failed';
  config_hash?: string | null;
  tested_model_id?: string | null;
  tested_at?: string | null;
  latency_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  estimated_cost_usd?: string | null;
  error_code?: string | null;
}

export interface AiSelectedModelView {
  id: string;
  name: string;
  context_length: number | null;
  max_completion_tokens: number | null;
  prompt_price_per_token: string | null;
  completion_price_per_token: string | null;
  price_per_1m_input_tokens: string;
  price_per_1m_output_tokens: string;
  expiration_date: string | null;
  supported_parameters: string[] | null;
}

export interface AiSettingsView {
  feature_code: string;
  provider: string;
  api_key_configured: boolean;
  selected_model: AiSelectedModelView | null;
  prompt_version: string;
  schema_version: string;
  provider_policy_version: string;
  adapter_version: string;
  require_zdr: boolean;
  data_collection_policy: string;
  require_parameters: boolean;
  allow_provider_fallbacks: boolean;
  request_timeout_seconds: number;
  max_output_tokens: number;
  temperature: number;
  candidate_limit: number;
  max_rows_per_request: number;
  max_concurrency: number;
  monthly_budget_usd: number | null;
  limits_editable: boolean;
  current_config_hash: string;
  model_test: AiTestView;
  enabled: boolean;
  needs_review_reason?: string | null;
  model_availability:
    | 'not_selected'
    | 'available'
    | 'missing'
    | 'expired'
    | 'catalog_unavailable';
  can_activate: boolean;
  activation_blockers: string[] | null;
  rollout_status: string;
  updated_at: string;
}

export interface AiScenarioResult {
  key: string;
  title: string;
  status: 'passed' | 'failed';
  reason?: string;
}

export interface AiModelTestReport {
  status: 'passed' | 'failed';
  error_code?: string;
  scenarios: AiScenarioResult[] | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd?: string;
  model_id: string;
  prompt_version: string;
  config_hash: string;
}

export interface AiCapabilityView {
  provider_configured: boolean;
  model_selected: boolean;
  model_test_passed: boolean;
  configuration_state:
    | 'not_configured'
    | 'model_not_selected'
    | 'test_required'
    | 'ready';
  rollout_status: string;
  status: string;
}

// ── Admin API ────────────────────────────────────────────────────────────────

export async function fetchOpenRouterStatus(): Promise<AiConnectionView> {
  const res = await apiFetch<{ data: AiConnectionView }>('/api/v1/admin/ai/openrouter/status');
  return res.data;
}

export async function testOpenRouterConnection(): Promise<AiConnectionView> {
  const res = await apiFetch<{ data: AiConnectionView }>(
    '/api/v1/admin/ai/openrouter/test-connection',
    { method: 'POST', timeoutMs: 70_000 }
  );
  return res.data;
}

export async function fetchOpenRouterModels(): Promise<AiCatalogView> {
  const res = await apiFetch<{ data: AiCatalogView }>('/api/v1/admin/ai/openrouter/models', {
    timeoutMs: 70_000,
  });
  return res.data;
}

export async function refreshOpenRouterModels(): Promise<AiCatalogView> {
  const res = await apiFetch<{ data: AiCatalogView }>(
    '/api/v1/admin/ai/openrouter/models/refresh',
    { method: 'POST', timeoutMs: 70_000 }
  );
  return res.data;
}

export async function fetchAiNomenclatureSettings(): Promise<AiSettingsView> {
  const res = await apiFetch<{ data: AiSettingsView }>('/api/v1/admin/ai/nomenclature-settings');
  return res.data;
}

/** Сохранить draft: ТОЛЬКО exact model ID из server-returned каталога. */
export async function saveAiNomenclatureDraft(selectedModelId: string): Promise<AiSettingsView> {
  const res = await apiFetch<{ data: AiSettingsView }>('/api/v1/admin/ai/nomenclature-settings', {
    method: 'PUT',
    body: JSON.stringify({ selected_model_id: selectedModelId }),
  });
  return res.data;
}

/** Синтетический тест сохранённого draft (тело не передаётся — §13/§17). */
export async function testAiNomenclatureModel(): Promise<{
  report: AiModelTestReport;
  settings: AiSettingsView;
}> {
  const res = await apiFetch<{ data: { report: AiModelTestReport; settings: AiSettingsView } }>(
    '/api/v1/admin/ai/nomenclature/test-model',
    { method: 'POST', timeoutMs: 150_000 }
  );
  return res.data;
}

export async function activateAiNomenclature(): Promise<AiSettingsView> {
  const res = await apiFetch<{ data: AiSettingsView }>('/api/v1/admin/ai/nomenclature/activate', {
    method: 'POST',
    timeoutMs: 70_000,
  });
  return res.data;
}

export async function deactivateAiNomenclature(): Promise<AiSettingsView> {
  const res = await apiFetch<{ data: AiSettingsView }>(
    '/api/v1/admin/ai/nomenclature/deactivate',
    { method: 'POST' }
  );
  return res.data;
}

// ── User capability (любой аутентифицированный пользователь) ────────────────

export async function fetchAiNomenclatureCapability(): Promise<AiCapabilityView> {
  const res = await apiFetch<{ data: AiCapabilityView }>('/api/v1/ai/nomenclature-capability');
  return res.data;
}
