// Конвейер проверки: выжимка по тендеру для руководства (этап 1.3).
// Хранится только текст и выбор категорий; цифры считаются из /cost-benchmarks.
import { apiFetch } from './client';

export interface TenderBrief {
  tender_id: string;
  summary_text: string;
  /** null — категории для блока цифр выбираются автоматически (крупнейшие). */
  fact_category_ids: string[] | null;
  updated_at: string | null;
  updated_by_name: string | null;
}

export async function fetchTenderBrief(tenderId: string): Promise<TenderBrief> {
  const res = await apiFetch<{ data: TenderBrief }>(`/api/v1/tenders/${tenderId}/brief`);
  return res.data;
}

export async function saveTenderBrief(
  tenderId: string,
  summaryText: string,
  factCategoryIds: string[] | null,
): Promise<TenderBrief> {
  const res = await apiFetch<{ data: TenderBrief }>(`/api/v1/tenders/${tenderId}/brief`, {
    method: 'PUT',
    body: JSON.stringify({ summary_text: summaryText, fact_category_ids: factCategoryIds }),
  });
  return res.data;
}
