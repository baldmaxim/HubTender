// Проверка данных: находки правил по тендеру и вердикты инженера.
// Каталог правил живёт в backend/internal/quality/rules/*.md и встроен в бинарь,
// поэтому фронт получает и сами находки, и человеческое описание правила.
// Формат правил и дисциплина порогов — docs/data-quality/README.md.
import { apiFetch } from './client';

export type QualitySeverity = 'error' | 'warning' | 'info';
export type QualityVerdict = 'accepted' | 'error';

/** Одна находка правила по конкретному тендеру. */
export interface QualityFinding {
  rule_code: string;
  rule_title: string;
  severity: QualitySeverity;
  /** Текст «Суть» из правила — показывается инженеру вместо LLM-объяснения. */
  summary: string;
  tender_id: string;
  position_number: number | null;
  item_no: string | null;
  entity_id: string;
  /** md5 значимых значений; изменились данные — вердикт перестаёт действовать. */
  fingerprint: string;
  detail: string;
  money_delta: number | null;
  /** Вердикт инженера, если он есть И отпечаток совпадает. */
  verdict: QualityVerdict | null;
  note: string | null;
}

/** Правило, которое не отработало. Остальные находки при этом остаются валидными. */
export interface QualityRuleError {
  rule_code: string;
  message: string;
}

export interface QualityReport {
  tender_id: string;
  generated_at: string;
  findings: QualityFinding[];
  errors: QualityRuleError[];
}

/** Правило каталога — метаданные для страницы. */
export interface QualityRule {
  Code: string;
  Title: string;
  Severity: QualitySeverity;
  Money: boolean;
  Status: 'active' | 'draft';
  Summary: string;
  SQL: string;
}

/** Строка выгрузки вердиктов — вход для замера точности правил. */
export interface QualityExportRow {
  tender_title: string;
  tender_version: number;
  rule_code: string;
  entity_id: string;
  verdict: QualityVerdict;
  note: string | null;
  created_at: string;
}

/**
 * Находки по тендеру. refresh=true обходит кэш — кнопка «Перепроверить».
 * Прогон читает все строки тендера, поэтому без refresh результат берётся из кэша.
 */
export async function fetchTenderQuality(
  tenderId: string,
  refresh = false,
): Promise<QualityReport> {
  const qs = refresh ? '?refresh=1' : '';
  const res = await apiFetch<{ data: QualityReport }>(
    `/api/v1/tenders/${tenderId}/quality${qs}`,
    { timeoutMs: 60_000 },
  );
  return res.data;
}

/** Вердикт инженера по находке. Отпечаток берётся из самой находки. */
export async function setQualityVerdict(
  tenderId: string,
  input: {
    rule_code: string;
    entity_id: string;
    fingerprint: string;
    verdict: QualityVerdict;
    note?: string | null;
  },
): Promise<void> {
  await apiFetch<void>(`/api/v1/tenders/${tenderId}/quality/verdict`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Каталог правил целиком, включая черновики. */
export async function fetchQualityRules(): Promise<QualityRule[]> {
  const res = await apiFetch<{ data: QualityRule[] }>('/api/v1/quality/rules');
  return res.data;
}

/** Выгрузка вердиктов по всей базе — для наращивания каталога. */
export async function fetchQualityExport(): Promise<QualityExportRow[]> {
  const res = await apiFetch<{ data: QualityExportRow[] }>('/api/v1/quality/export');
  return res.data;
}
