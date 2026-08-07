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
  // feature/ai-key-ui: источник действующего ключа (сам ключ сюда не приходит никогда)
  key_source: 'ui' | 'env' | 'none';
  key_suffix?: string | null;
  key_set_at?: string | null;
  env_key_available: boolean;
  /** Транспорт LLM. В режиме proxy_llm ключа и его лимитов не существует. */
  provider_mode: 'openrouter' | 'proxy_llm';
  /** Заполнен только в режиме proxy_llm; при этом key всегда null. */
  proxy?: AiProxyStatus | null;
}

/**
 * Всё, что известно о LLM-прокси без GET /key.
 *
 * `health` — публичная проба /healthz. Она НЕ доказывает ни того, что наш
 * egress-IP в allowlist прокси, ни того, что токен принят: allowlist висит на
 * location /api/, а /healthz лежит вне его. Это подтверждает только реальный
 * вызов — model test.
 */
export interface AiProxyStatus {
  health: 'ok' | 'unreachable';
  health_checked_at?: string | null;
  /** Модель, фактически ответившая на последний вызов (прокси выбирает сам). */
  observed_model?: string | null;
  /** Всегда false: лимитами и расходом ключа распоряжается оператор прокси. */
  limits_known: boolean;
}

export interface AiKeyState {
  configured: boolean;
  suffix?: string | null;
  set_at?: string | null;
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
  /**
   * Применяются ли require_zdr / data_collection_policy / require_parameters
   * на стороне провайдера. В режиме proxy_llm — false: прокси вырезает объект
   * provider, и эти поля остаются намерением, а не гарантией.
   */
  provider_policy_enforced: boolean;
  provider_mode: 'openrouter' | 'proxy_llm';
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

// Этап 2.6: расширенная capability текущего пользователя (§17/§19).
export type AiCapabilityStatus =
  | 'rollout_off'
  | 'evaluation_only'
  | 'not_allowed'
  | 'available'
  | 'user_quota_exhausted'
  | 'row_quota_exhausted'
  | 'budget_exhausted'
  | 'token_budget_exhausted'
  | 'key_limit_exhausted'
  | 'circuit_open'
  | 'provider_unavailable'
  | 'rate_limited';

export interface AiCapabilityView {
  status: AiCapabilityStatus;
  rollout_mode: 'off' | 'evaluation' | 'pilot_individual' | 'pilot_bulk';
  is_pilot: boolean;
  individual_suggestions_allowed: boolean;
  bulk_confirmation_allowed: boolean;
  requests_remaining_today: number;
  rows_remaining_today: number;
  budget_status: 'ok' | 'exhausted' | 'not_set';
  provider_status: string;
  model_label: string;
  prompt_version: string;
}

// ── Этап 2.6: controlled rollout (admin) ─────────────────────────────────────

export interface AiGateCheck {
  key: string;
  title: string;
  passed: boolean;
  detail?: string;
}

export interface AiCircuitState {
  feature_code: string;
  state: 'closed' | 'open' | 'half_open';
  consecutive_failures: number;
  open_until: string | null;
  last_failure_code: string | null;
  last_success_at: string | null;
  updated_at: string;
}

export interface AiEvaluationStatus {
  id: string;
  gates_passed: boolean;
  current: boolean;
  dataset_size: number;
  dataset_hash: string;
  executed_at: string;
}

export interface AiRolloutView {
  feature_code: string;
  rollout_mode: 'off' | 'evaluation' | 'pilot_individual' | 'pilot_bulk';
  rollout_config_version: number;
  current_config_hash: string;
  selected_model_id: string | null;
  model_test_status: string;
  live_evaluation: AiEvaluationStatus | null;
  daily_request_limit: number;
  daily_row_limit: number;
  monthly_budget_usd: number | null;
  request_max_reserved_cost_usd: string;
  circuit_failure_threshold: number;
  circuit_cooldown_seconds: number;
  reservation_timeout_seconds: number;
  circuit: AiCircuitState | null;
  pilot_users_count: number;
  pilot_started_at: string | null;
  pilot_ended_at: string | null;
  next_transition_gates: Record<string, AiGateCheck[]>;
  updated_by: string | null;
  updated_at: string;
  cost_unit: string;
  /** Смысл числа в monthly_budget_usd. В режиме proxy_llm это НЕ доллары. */
  budget_kind: 'usd' | 'reservation_units';
  /** Потолок числа запросов при плоском резерве (бюджет / резерв за запрос). */
  max_requests_month: number | null;
  /** Измеримый потолок в токенах; null = не задан. */
  monthly_token_budget: number | null;
}

export interface AiPilotUser {
  feature_code: string;
  user_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  daily_request_limit_override: number | null;
  daily_row_limit_override: number | null;
  bulk_confirmation_allowed: boolean;
  expires_at: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiUsageSummary {
  requests_today: number;
  requests_month: number;
  rows_today: number;
  rows_month: number;
  tokens_month: number;
  provider_cost_month_usd: string;
  estimated_cost_month_usd: string;
  reserved_active_amount_usd: string;
  active_reservations: number;
  oldest_reservation_age_seconds: number;
  timeouts_month: number;
  rate_limited_month: number;
  invalid_month: number;
  stale_discarded_month: number;
  feedback_accepted: number;
  feedback_changed: number;
  feedback_manual: number;
  feedback_abstained: number;
  feedback_unresolved: number;
  high_confidence_changed: number;
  high_confidence_total: number;
  successful_row_outcomes: number;
}

export interface AiEvaluationSummary {
  id: string;
  feature_code: string;
  eval_mode: 'deterministic' | 'mock' | 'live';
  dataset_kind: string;
  dataset_hash: string;
  dataset_size: number;
  model_id: string;
  prompt_version: string;
  config_hash: string;
  metrics: Record<string, unknown>;
  gates_passed: boolean;
  gate_details: AiGateCheck[];
  executed_by: string | null;
  executed_at: string;
}

export interface AiEvalRunResult {
  mode: string;
  metrics: Record<string, unknown>;
  gates: AiGateCheck[];
  gates_passed: boolean;
}

// ── Admin API ────────────────────────────────────────────────────────────────

export async function fetchOpenRouterStatus(): Promise<AiConnectionView> {
  const res = await apiFetch<{ data: AiConnectionView }>('/api/v1/admin/ai/openrouter/status');
  return res.data;
}

// Write-only: ключ отправляется на сервер и никогда не читается назад.
// Ответ сразу содержит свежий connection-view (авто-проверка нового ключа).
export async function setOpenRouterKey(apiKey: string): Promise<AiConnectionView> {
  const res = await apiFetch<{ data: { key_state: AiKeyState; connection: AiConnectionView } }>(
    '/api/v1/admin/ai/openrouter/key',
    { method: 'POST', body: JSON.stringify({ api_key: apiKey }), timeoutMs: 70_000 }
  );
  return res.data.connection;
}

export async function deleteOpenRouterKey(): Promise<AiConnectionView> {
  const res = await apiFetch<{ data: { connection: AiConnectionView } }>(
    '/api/v1/admin/ai/openrouter/key',
    { method: 'DELETE', timeoutMs: 70_000 }
  );
  return res.data.connection;
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

// ── Этап 2.6: rollout admin API ──────────────────────────────────────────────

export async function fetchAiRollout(): Promise<AiRolloutView> {
  const res = await apiFetch<{ data: AiRolloutView }>('/api/v1/admin/ai/nomenclature/rollout');
  return res.data;
}

export async function updateAiRolloutSettings(patch: {
  daily_request_limit?: number;
  daily_row_limit?: number;
  monthly_budget_usd?: string;
  request_max_reserved_cost?: string;
  circuit_failure_threshold?: number;
  circuit_cooldown_seconds?: number;
  reservation_timeout_seconds?: number;
}): Promise<AiRolloutView> {
  const res = await apiFetch<{ data: AiRolloutView }>(
    '/api/v1/admin/ai/nomenclature/rollout/settings',
    { method: 'PUT', body: JSON.stringify(patch) }
  );
  return res.data;
}

/** Переход: подтверждение = точное имя целевого режима (§17). */
export async function transitionAiRollout(
  target: string, confirmation: string, reason?: string
): Promise<AiRolloutView> {
  const res = await apiFetch<{ data: AiRolloutView }>(
    '/api/v1/admin/ai/nomenclature/rollout/transition',
    { method: 'POST', body: JSON.stringify({ target, confirmation, reason: reason ?? '' }) }
  );
  return res.data;
}

/** Экстренное отключение: без гейтов, без OpenRouter (§11). */
export async function emergencyOffAiRollout(reason?: string): Promise<AiRolloutView> {
  const res = await apiFetch<{ data: AiRolloutView }>(
    '/api/v1/admin/ai/nomenclature/rollout/emergency-off',
    { method: 'POST', body: JSON.stringify({ reason: reason ?? '' }) }
  );
  return res.data;
}

export async function fetchAiPilotUsers(): Promise<AiPilotUser[]> {
  const res = await apiFetch<{ data: AiPilotUser[] }>('/api/v1/admin/ai/nomenclature/pilot-users');
  return res.data ?? [];
}

export async function addAiPilotUser(
  userId: string, bulkAllowed: boolean, expiresAt?: string | null
): Promise<AiPilotUser> {
  const res = await apiFetch<{ data: AiPilotUser }>('/api/v1/admin/ai/nomenclature/pilot-users', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      bulk_confirmation_allowed: bulkAllowed,
      expires_at: expiresAt ?? null,
    }),
  });
  return res.data;
}

export async function patchAiPilotUser(userId: string, patch: {
  is_active?: boolean;
  daily_request_limit_override?: number;
  daily_row_limit_override?: number;
  bulk_confirmation_allowed?: boolean;
  expires_at?: string;
  clear_expires_at?: boolean;
}): Promise<AiPilotUser> {
  const res = await apiFetch<{ data: AiPilotUser }>(
    `/api/v1/admin/ai/nomenclature/pilot-users/${userId}`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  );
  return res.data;
}

export async function removeAiPilotUser(userId: string): Promise<void> {
  await apiFetch(`/api/v1/admin/ai/nomenclature/pilot-users/${userId}`, { method: 'DELETE' });
}

export async function fetchAiUsage(): Promise<{ summary: AiUsageSummary; cost_unit: string }> {
  const res = await apiFetch<{ data: { summary: AiUsageSummary; cost_unit: string } }>(
    '/api/v1/admin/ai/nomenclature/usage'
  );
  return res.data;
}

export async function fetchAiEvaluations(): Promise<AiEvaluationSummary[]> {
  const res = await apiFetch<{ data: AiEvaluationSummary[] }>(
    '/api/v1/admin/ai/nomenclature/evaluations'
  );
  return res.data ?? [];
}

export async function runAiEvaluation(
  mode: 'deterministic' | 'mock' | 'live', confirmCost: boolean
): Promise<{ result: AiEvalRunResult; summary: AiEvaluationSummary | null }> {
  const res = await apiFetch<{ data: { result: AiEvalRunResult; summary: AiEvaluationSummary | null } }>(
    '/api/v1/admin/ai/nomenclature/evaluate',
    {
      method: 'POST',
      body: JSON.stringify({ mode, confirm_live_provider_cost: confirmCost }),
      timeoutMs: 320_000,
    }
  );
  return res.data;
}

export async function resetAiCircuit(): Promise<AiCircuitState> {
  const res = await apiFetch<{ data: AiCircuitState }>(
    '/api/v1/admin/ai/nomenclature/circuit/reset',
    { method: 'POST' }
  );
  return res.data;
}
