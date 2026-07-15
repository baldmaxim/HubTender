// Этап 2.2: pure-политика UI AI-подбора номенклатуры (§15-16).
// Без зависимостей от env/API — модуль тестируется автономно.
import type {
  NomenclatureSelectionInput, SmartAiCandidate, SmartIssue, SmartSuggestionRow,
} from '../api/boqSmartImport';

// ─── Состояние подтверждений (auto-select запрещён — только пользователь) ────

export interface NomenclatureSelectionState {
  catalogId: string;
  label: string;
  source: 'ai_confirmed' | 'manual';
  // Этап 2.3 (§7): «Запомнить для следующих импортов». Default false;
  // выставляется ТОЛЬКО явным действием пользователя.
  remember?: boolean;
}

/** row_reference ("Лист|строка") → подтверждённый выбор. */
export type SelectionsMap = Record<string, NomenclatureSelectionState>;

export function rowReferenceOf(sheet: string, excelRow: number): string {
  return `${sheet}|${excelRow}`;
}

/** Строки, для которых имеет смысл подбор: nomenclature-блокеры анализа. */
export function unresolvedNomenclatureRefs(issues: SmartIssue[], sheet: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const i of issues) {
    if (i.code !== 'NOMENCLATURE_NOT_FOUND' && i.code !== 'NOMENCLATURE_AMBIGUOUS') continue;
    const ref = rowReferenceOf(i.sheet || sheet, i.excel_row);
    if (!seen.has(ref)) { seen.add(ref); refs.push(ref); }
  }
  return refs;
}

/** Selections → payload execute/analyze (§13). Источник только допустимый. */
export function selectionsForExecute(selections: SelectionsMap): NomenclatureSelectionInput[] {
  return Object.entries(selections).map(([row_reference, s]) => ({
    row_reference,
    catalog_id: s.catalogId,
    selection_source: s.source,
    remember_selection: s.remember === true, // §7: default false
  }));
}

// ─── Отображение уверенности и статусов ──────────────────────────────────────

export function suggestionConfidenceDisplay(confidence: string): { label: string; color: string } {
  switch (confidence) {
    case 'high': return { label: 'высокая', color: 'green' };
    case 'medium': return { label: 'средняя', color: 'orange' };
    case 'low': return { label: 'низкая', color: 'volcano' };
    default: return { label: 'выбор не определён', color: 'default' };
  }
}

export const ABSTAIN_TEXT = 'Подходящий вариант не определён — выберите вручную.';

export function suggestionStatusText(row: SmartSuggestionRow): string {
  switch (row.status) {
    case 'suggested': return 'Есть предложение';
    case 'abstain': return ABSTAIN_TEXT;
    case 'no_candidates': return 'Кандидатов в справочнике не найдено';
    case 'ai_invalid_response': return 'Ответ AI отклонён проверкой — используйте список кандидатов';
    case 'deterministic_only': return 'Кандидаты подобраны без AI';
    default: return row.status;
  }
}

/** §11: провайдер недоступен ≠ ошибка импорта; deterministic-часть работает. */
export function providerStatusDisplay(status: string): { text: string; tone: 'info' | 'warning' } | null {
  switch (status) {
    case 'available': return null;
    case 'disabled':
      return { text: 'AI-провайдер отключён — показаны детерминированные кандидаты. Выбор остаётся за вами.', tone: 'info' };
    case 'timeout':
      return { text: 'AI-сервис не ответил вовремя — показаны детерминированные кандидаты.', tone: 'warning' };
    case 'rate_limited':
      return { text: 'AI-сервис ограничил частоту запросов — повторите позже. Кандидаты доступны.', tone: 'warning' };
    case 'invalid_response':
      return { text: 'Ответ AI-сервиса не прошёл проверку — показаны детерминированные кандидаты.', tone: 'warning' };
    default:
      return { text: 'AI-сервис недоступен — показаны детерминированные кандидаты. Импорт вручную не заблокирован.', tone: 'warning' };
  }
}

// ─── Раскрытие информации (§16) ──────────────────────────────────────────────

export const AI_DISCLOSURE_TEXT =
  'Предложение сформировано автоматически и требует подтверждения инженером. '
  + 'Ни один вариант не применяется без вашего явного действия.';

export const DATA_MINIMIZATION_TEXT =
  'Во внешний сервис передаются только: описание строки, тип элемента, единица '
  + 'измерения и серверный список кандидатов. Количества, цены, суммы, валюты '
  + 'и реквизиты тендера НЕ передаются.';

// ─── Принятие и bulk-подтверждение (§16) ─────────────────────────────────────

export function candidateById(row: SmartSuggestionRow, id: string | null | undefined): SmartAiCandidate | null {
  if (!id) return null;
  return row.candidates.find((c) => c.id === id) ?? null;
}

/** Кнопка «Принять» активна только когда AI дал конкретное предложение. */
export function isAcceptable(row: SmartSuggestionRow): boolean {
  return row.status === 'suggested' && !!row.selected_candidate_id
    && !!candidateById(row, row.selected_candidate_id);
}

/** Bulk-подтверждение (§16): ТОЛЬКО high и без конфликтов единиц/маркировок. */
export function isBulkConfirmEligible(row: SmartSuggestionRow): boolean {
  if (!isAcceptable(row) || row.confidence !== 'high') return false;
  const cand = candidateById(row, row.selected_candidate_id);
  if (!cand) return false;
  if (cand.unit_compatibility === 'conflict' || cand.significant_token_conflict) return false;
  return (row.conflicting_features?.length ?? 0) === 0;
}

export function bulkConfirmableRows(rows: SmartSuggestionRow[], selections: SelectionsMap): SmartSuggestionRow[] {
  return rows.filter((r) => isBulkConfirmEligible(r) && !selections[r.row_reference]);
}

export function bulkConfirmDialogText(count: number): string {
  return `Будут подтверждены ${count} предложений с высокой уверенностью и без конфликтов. `
    + 'Остальные строки требуют ручного решения. Продолжить?';
}

/** §15: смена файла/fingerprint делает предложения недействительными. */
export function suggestionsStale(suggestFingerprint: string | undefined, analysisFingerprint: string | undefined): boolean {
  if (!suggestFingerprint || !analysisFingerprint) return false;
  return suggestFingerprint !== analysisFingerprint;
}

/** Сводка подтверждений для шага execute. */
export function selectionSummary(selections: SelectionsMap): { total: number; ai: number; manual: number } {
  let ai = 0; let manual = 0;
  for (const s of Object.values(selections)) {
    if (s.source === 'ai_confirmed') ai += 1; else manual += 1;
  }
  return { total: ai + manual, ai, manual };
}
