// Чистые хелперы панели готовности по разделам ВОР. Без React — проверяются
// scripts/checks/sectionsPolicy.check.mjs.
import type { SectionStageState, TenderSection } from '../api/verificationSections';

export interface SectionsSummary {
  total: number;
  priced: number;
  reviewed: number;
  /** Отметка «проверено» есть, но раздел изменился после неё. */
  changed: number;
  /** Разделы, где нет конечных позиций (одни заголовки) — в готовность не входят. */
  empty: number;
}

/**
 * Сводка готовности. Раздел, где нечего расценивать (одни заголовки и текстовые
 * строки), не учитывается — он только занижал бы долю готовых.
 */
export function summarizeSections(sections: TenderSection[]): SectionsSummary {
  const summary: SectionsSummary = { total: 0, priced: 0, reviewed: 0, changed: 0, empty: 0 };
  for (const s of sections) {
    if (s.pricing_status === 'not_required') {
      summary.empty += 1;
      continue;
    }
    summary.total += 1;
    if (s.pricing_status === 'complete') summary.priced += 1;
    if (s.review.status === 'marked') summary.reviewed += 1;
    if (s.review.status === 'changed') summary.changed += 1;
  }
  return summary;
}

/** Подпись статуса расценки раздела. */
export function pricingStatusLabel(s: TenderSection): { text: string; color: string } {
  switch (s.pricing_status) {
    case 'complete':
      return { text: 'расценено', color: 'green' };
    case 'in_progress':
      return { text: `заполнено ${s.complete} из ${s.required}`, color: 'blue' };
    case 'not_started':
      return { text: `не начато (0 из ${s.required})`, color: 'default' };
    default:
      return { text: 'нечего расценивать', color: 'default' };
  }
}

/**
 * Что в разделе ещё не заполнено — показывается при отметке «проверено». Не
 * блокирует отметку (процесс цикличный), но проверяющий видит, что заверяет.
 */
export function pricingBlockers(s: TenderSection): string[] {
  const out: string[] = [];
  if (s.unpriced_no_reason > 0) out.push(`не расценено без обоснования: ${s.unpriced_no_reason}`);
  if (s.priced_no_gp > 0) out.push(`без Кол-ва ГП: ${s.priced_no_gp}`);
  if (s.open_errors > 0) out.push(`ошибок проверки: ${s.open_errors}`);
  return out;
}

/** Текст подсказки для отметки, изменённой после установки. */
export function changedDescription(st: SectionStageState): string {
  if (st.status !== 'changed') return '';
  const parts = ['Раздел изменился после отметки'];
  const ch = st.changes;
  if (ch && ch.row_edits > 0) {
    parts.push(`правок строк: ${ch.row_edits}`);
    if (ch.authors.length > 0) parts.push(`авторы: ${ch.authors.join(', ')}`);
  } else {
    parts.push('менялись поля позиций (Кол-во ГП, примечание, структура)');
  }
  return parts.join('; ');
}
