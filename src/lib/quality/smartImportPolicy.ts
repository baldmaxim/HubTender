// Этап 2.1: чистые helpers мастера «Умный импорт BOQ». Без React/DOM.
// Frontend не нормализует финансовые значения и не помечает preview как
// импортированный до ответа сервера.
import type { SmartAnalysis, SmartIssue, SmartMapping, SmartPreviewRow } from '../api/boqSmartImport';

/** Порядок шагов мастера (§13). */
export const WIZARD_STEPS = [
  'Файл', 'Лист и заголовки', 'Сопоставление колонок', 'Проверка строк', 'Импорт', 'Результат',
] as const;

/** Confidence: текст + цвет (не только цвет). */
export const CONFIDENCE_DISPLAY: Record<string, { label: string; color: string }> = {
  high: { label: 'Высокая', color: 'green' },
  medium: { label: 'Средняя', color: 'orange' },
  low: { label: 'Низкая', color: 'volcano' },
  unresolved: { label: 'Не определено', color: 'red' },
};

export function confidenceDisplay(c: string): { label: string; color: string } {
  return CONFIDENCE_DISPLAY[c] ?? { label: c || 'Неизвестно', color: 'default' };
}

export const ROW_STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  ready: { label: 'Готова', color: 'green' },
  warning: { label: 'Предупреждение', color: 'orange' },
  blocked: { label: 'Заблокирована', color: 'red' },
  skipped: { label: 'Пропущена', color: 'default' },
};

export function rowStatusDisplay(s: string): { label: string; color: string } {
  return ROW_STATUS_DISPLAY[s] ?? { label: s, color: 'default' };
}

/** Незакрытые обязательные mapping (§13). */
export function unresolvedRequired(mapping: SmartMapping[]): SmartMapping[] {
  return mapping.filter((m) => m.required && !m.source_column && !m.fixed_value);
}

/** Готовность execute (§13): required сопоставлены, blockers = 0, формулы
 *  подтверждены (или отсутствуют), fingerprint соответствует текущему файлу. */
export function isExecuteReady(
  analysis: Pick<SmartAnalysis, 'summary' | 'mapping'> | null,
  formulaConfirmed: boolean,
  fingerprintMatches: boolean,
): boolean {
  if (!analysis || !fingerprintMatches) return false;
  if (unresolvedRequired(analysis.mapping).length > 0) return false;
  if (analysis.summary.required_mappings_missing > 0) return false;
  if (analysis.summary.rows_blocked > 0) return false;
  if (analysis.summary.formula_confirmations_required > 0 && !formulaConfirmed) return false;
  return true;
}

/** Фильтр issues по severity. */
export function filterIssues(issues: SmartIssue[], severity: string | null): SmartIssue[] {
  if (!severity || severity === 'all') return issues;
  return issues.filter((i) => i.severity === severity);
}

/** Фильтр preview-строк по статусу. */
export function filterPreviewRows(rows: SmartPreviewRow[], status: string | null): SmartPreviewRow[] {
  if (!status || status === 'all') return rows;
  return rows.filter((r) => r.status === status);
}

/** Кандидаты колонки, отсортированные по score (сервер уже сортирует —
 *  сохраняем порядок и не пересчитываем). */
export function candidateOptions(m: SmartMapping): { value: string; label: string }[] {
  const opts = (m.candidates ?? []).map((c) => ({
    value: c.source_column,
    label: `${c.source_column} — ${c.source_header || '(без заголовка)'}`,
  }));
  return opts;
}

/** Сводка результата импорта (server-значения, без пересчёта). */
export function resultSummaryText(inserted: number, mismatches: number, skipped: number): string {
  const parts = [`Импортировано строк: ${inserted}`];
  if (skipped > 0) parts.push(`пропущено служебных: ${skipped}`);
  if (mismatches > 0) parts.push(`расхождений с Excel-суммой (диагностика): ${mismatches}`);
  return parts.join('; ') + '.';
}

/** Сообщение при неоднозначном листе (§6). */
export function sheetNeedsConfirmation(analysis: Pick<SmartAnalysis, 'sheet_confidence' | 'sheets'>): boolean {
  return analysis.sheet_confidence !== 'high' && analysis.sheets.length > 1;
}

export const FINGERPRINT_MISMATCH_TEXT =
  'Файл изменился после анализа — загрузите его заново и повторите проверку.';
export const BLOCKED_EXECUTE_TEXT =
  'Импорт недоступен: устраните blockers и сопоставьте обязательные колонки.';
