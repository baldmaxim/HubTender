// Проверка данных: находки правил по тендеру и вердикты инженера.
// Каталог правил живёт в backend/internal/quality/rules/*.md и встроен в бинарь,
// поэтому фронт получает и сами находки, и человеческое описание правила.
// Формат правил и дисциплина порогов — docs/data-quality/README.md.
import { apiFetch } from './client';

export type QualitySeverity = 'error' | 'warning' | 'info';
export type QualityVerdict = 'accepted' | 'error';
export type QualityEntityType = 'boq_item' | 'client_position' | 'material_name' | 'tender';

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
  /** Пространство id в entity_id — из фронтматтера правила. */
  entity_type: QualityEntityType;
  entity_id: string;
  /** md5 значимых значений; изменились данные — вердикт перестаёт действовать. */
  fingerprint: string;
  detail: string;
  money_delta: number | null;
  /** Вердикт инженера, если он есть И отпечаток совпадает. */
  verdict: QualityVerdict | null;
  note: string | null;
  /** Сохранённая находка; null, если прогон не удалось сохранить. */
  finding_id: string | null;
  /** Когда находка появилась (или открылась заново после исправления/смены данных). */
  first_seen_at: string | null;
  /** Появилась после последней отметки «Проверка завершена». */
  is_new: boolean;
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
  run_id: string | null;
  /** Последняя отметка «Проверка завершена»; от неё считается новизна. */
  checkpoint_at: string | null;
  /** false — прогон не сохранён (например, не применена миграция), истории нет. */
  history_available: boolean;
}

/** Правило каталога — метаданные для страницы. */
export interface QualityRule {
  Code: string;
  Title: string;
  Severity: QualitySeverity;
  Money: boolean;
  Status: 'active' | 'draft';
  EntityType: QualityEntityType;
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

/**
 * «Проверка завершена»: правила прогоняются заново, и всё, что найдено сейчас,
 * считается просмотренным. Дальше новыми будут только находки, появившиеся после.
 */
export async function markQualityCheckpoint(tenderId: string): Promise<QualityReport> {
  const res = await apiFetch<{ data: QualityReport }>(
    `/api/v1/tenders/${tenderId}/quality/checkpoint`,
    { method: 'POST', timeoutMs: 60_000 },
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

/** Один вердикт в пачке. */
export interface QualityVerdictInput {
  rule_code: string;
  entity_id: string;
  fingerprint: string;
  verdict: QualityVerdict;
  note?: string | null;
}

/**
 * Размер части при массовой отправке. Правило Q даёт больше пяти тысяч находок,
 * поэтому «принять всю группу» режется на части: сорвавшийся запрос не отменяет
 * всю работу, а сервер не получает мегабайтное тело.
 */
export const VERDICT_CHUNK_SIZE = 1000;

/**
 * Пачка вердиктов. Отправляется частями последовательно: параллель здесь ничего
 * не ускоряет (запись в одну таблицу), а порядок помогает при разборе сбоя.
 */
export async function setQualityVerdicts(
  tenderId: string,
  items: QualityVerdictInput[],
): Promise<void> {
  for (let i = 0; i < items.length; i += VERDICT_CHUNK_SIZE) {
    const chunk = items.slice(i, i + VERDICT_CHUNK_SIZE);
    await apiFetch<void>(`/api/v1/tenders/${tenderId}/quality/verdicts`, {
      method: 'POST',
      body: JSON.stringify({ items: chunk }),
      timeoutMs: 60_000,
    });
  }
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
