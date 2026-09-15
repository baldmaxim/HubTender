// Чистые хелперы панели готовности по разделам ВОР. Без React — проверяются
// scripts/checks/sectionsPolicy.check.mjs.
import type { SectionStageState, TenderSection } from '../api/verificationSections';

export interface SectionsSummary {
  total: number;
  priced: number;
  reviewed: number;
  /** Отметка есть, но раздел изменился после неё — хоть один из этапов. */
  changed: number;
  /** Разделы, где нет конечных позиций (одни заголовки) — в готовность не входят. */
  empty: number;
}

/**
 * Сводка готовности. Раздел без конечных позиций не учитывается: отмечать там
 * нечего, и он только занижал бы долю готовых.
 */
export function summarizeSections(sections: TenderSection[]): SectionsSummary {
  const summary: SectionsSummary = { total: 0, priced: 0, reviewed: 0, changed: 0, empty: 0 };
  for (const s of sections) {
    if (s.positions === 0) {
      summary.empty += 1;
      continue;
    }
    summary.total += 1;
    if (s.pricing.status === 'marked') summary.priced += 1;
    if (s.review.status === 'marked') summary.reviewed += 1;
    if (s.pricing.status === 'changed' || s.review.status === 'changed') summary.changed += 1;
  }
  return summary;
}

/**
 * Что мешает честно отметить раздел расценённым — те же пункты, что проверяющий
 * смотрит глазами. Не блокирует отметку (процесс цикличный), но показывается
 * рядом с кнопкой.
 */
export function pricingBlockers(s: TenderSection): string[] {
  const out: string[] = [];
  const unpriced = s.positions - s.priced;
  if (unpriced > 0) out.push(`не расценено позиций: ${unpriced}`);
  if (s.unpriced_no_reason > 0) out.push(`без обоснования: ${s.unpriced_no_reason}`);
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
