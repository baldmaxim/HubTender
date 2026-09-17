// Конвейер проверки: ИИ-разбор находок. Модель оценивает находку — «похоже на
// ошибку», «похоже на норму», «не уверен» — со ссылками на поля расчёта. Это
// подсказка проверяющему: вердикт по-прежнему ставит инженер.
import { apiFetch } from './client';

export type AILabel = 'likely_error' | 'likely_ok' | 'unsure';

export type AIAvailability =
  | 'started'
  | 'already_running'
  | 'disabled'
  | 'tender_not_in_pilot'
  | 'not_configured';

export interface AIEvidence {
  ref: string;
  value: string;
}

export interface AIAssessment {
  finding_id: string;
  rule_code: string;
  label: AILabel;
  reason: string;
  evidence: AIEvidence[];
  /** false — данные находки изменились после оценки или сменилась версия промпта. */
  current: boolean;
  model_id: string;
  created_at: string;
}

export interface TenderAIAssessments {
  /** started — разбор можно запустить; already_running — идёт сейчас. */
  availability: AIAvailability;
  running: boolean;
  assessments: AIAssessment[];
}

export interface AIUsage {
  month_tokens: number;
  month_cost: number;
  month_requests: number;
  today_requests: number;
  month_failed: number;
  last_request_at: string | null;
}

export interface AIAgreement {
  error_agreed: number;
  error_missed: number;
  ok_agreed: number;
  ok_missed: number;
  unsure: number;
}

export interface AISettingsInput {
  enabled: boolean;
  model_id: string | null;
  allowed_tender_ids: string[] | null;
  max_findings_per_run: number;
  batch_size: number;
  max_output_tokens: number;
  request_timeout_seconds: number;
  monthly_token_budget: number;
  daily_request_limit: number;
}

export interface AISettings extends AISettingsInput {
  last_test_at: string | null;
  last_test_model_id: string | null;
  last_test_status: 'passed' | 'failed' | null;
  last_test_error: string | null;
  last_test_latency_ms: number | null;
  updated_at: string;
  configured: boolean;
  transport: string;
  prompt_version: string;
  usage: AIUsage;
  agreement: AIAgreement;
  paused_until: string | null;
}

export interface AITestResult {
  passed: boolean;
  label: AILabel | '';
  reason: string;
  evidence: AIEvidence[] | null;
  error?: string;
  latency_ms: number;
  tokens: number;
}

export async function fetchTenderAIAssessments(tenderId: string): Promise<TenderAIAssessments> {
  const res = await apiFetch<{ data: TenderAIAssessments }>(`/api/v1/tenders/${tenderId}/verification/ai-assessments`);
  return res.data;
}

export async function startAITriage(tenderId: string): Promise<AIAvailability> {
  const res = await apiFetch<{ data: { status: AIAvailability } }>(
    `/api/v1/tenders/${tenderId}/verification/ai-triage`,
    { method: 'POST' },
  );
  return res.data.status;
}

export async function fetchAISettings(): Promise<AISettings> {
  const res = await apiFetch<{ data: AISettings }>('/api/v1/verification/ai-settings');
  return res.data;
}

export async function saveAISettings(input: AISettingsInput): Promise<AISettings> {
  const res = await apiFetch<{ data: AISettings }>('/api/v1/verification/ai-settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function testAIModel(): Promise<AITestResult> {
  const res = await apiFetch<{ data: AITestResult }>('/api/v1/verification/ai-settings/test', {
    method: 'POST',
    timeoutMs: 180_000,
  });
  return res.data;
}
