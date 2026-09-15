// Конвейер проверки: готовность по разделам ВОР.
// Раздел выводится из иерархии позиций на сервере. «Расценено» вычисляется по
// заполненности позиций; «проверено» ставит проверяющий — отметка хранит хеш
// содержимого раздела и превращается в «изменён после отметки», если раздел правят.
import { apiFetch } from './client';

/** Ручной этап — только проверка: «расценено» вычисляется автоматически. */
export type SectionStage = 'review';
export type SectionPricingStatus = 'not_required' | 'not_started' | 'in_progress' | 'complete';
export type SectionStageStatus = 'none' | 'marked' | 'changed';

export interface SectionChanges {
  /** Правок строк после отметки. Правки полей позиции (ГП, примечание) сюда не входят. */
  row_edits: number;
  last_change_at: string | null;
  authors: string[];
}

export interface SectionStageState {
  status: SectionStageStatus;
  marked_by: string | null;
  marked_by_name: string | null;
  marked_at: string | null;
  note: string | null;
  changes: SectionChanges | null;
}

export interface TenderSection {
  /** 'h:<id заголовка>' | 'none' | 'additional' */
  key: string;
  title: string;
  header_position_id: string | null;
  first_position_number: number | null;
  /** Конечные позиции раздела (без заголовков). */
  positions: number;
  /** Позиций, требующих расценки: есть объём заказчика или занесены строки. */
  required: number;
  /** Заполнены: расценены с Кол-вом ГП либо не расценены, но с обоснованием. */
  complete: number;
  /** «Расценено» по разделу — вычисляется из required/complete. */
  pricing_status: SectionPricingStatus;
  priced: number;
  unpriced_no_reason: number;
  priced_no_gp: number;
  total_amount: number;
  content_hash: string;
  open_errors: number;
  open_warnings: number;
  review: SectionStageState;
}

export interface TenderSections {
  tender_id: string;
  hash_version: number;
  sections: TenderSection[];
  /** Счётчики находок взяты из сохранённого прогона проверки. */
  findings_available: boolean;
}

export async function fetchTenderSections(tenderId: string): Promise<TenderSections> {
  const res = await apiFetch<{ data: TenderSections }>(
    `/api/v1/tenders/${tenderId}/verification/sections`,
    { timeoutMs: 60_000 },
  );
  return res.data;
}

/**
 * Отметить раздел. content_hash — хеш, который видел пользователь: если раздел
 * успели изменить, сервер ответит 409 SECTION_CHANGED.
 */
export async function markTenderSection(
  tenderId: string,
  input: { section_key: string; stage: SectionStage; content_hash: string; note?: string | null },
): Promise<void> {
  await apiFetch<void>(`/api/v1/tenders/${tenderId}/verification/sections/mark`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function unmarkTenderSection(
  tenderId: string,
  input: { section_key: string; stage: SectionStage },
): Promise<void> {
  await apiFetch<void>(`/api/v1/tenders/${tenderId}/verification/sections/unmark`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Ошибка «раздел изменился после загрузки». */
export function isSectionChangedError(error: unknown): boolean {
  const e = error as { status?: number; body?: { code?: string } } | null;
  return !!e && e.status === 409 && e.body?.code === 'SECTION_CHANGED';
}
