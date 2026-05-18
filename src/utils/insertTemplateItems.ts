import { apiFetch } from '../lib/api/client';

interface InsertTemplateResult {
  worksCount: number;
  materialsCount: number;
  totalInserted: number;
}

/**
 * Вставить все элементы шаблона в позицию заказчика (BOQ).
 *
 * Вся логика выполняется атомарно на Go BFF в одной транзакции:
 * выборка template_items + works/materials библиотек, расчёт
 * total_amount по легаси-формуле шаблона, bulk-insert boq_items,
 * восстановление parent_work_item_id, пересчёт итогов позиции и
 * запись audit-строк. Актор аудита берётся из JWT на сервере, поэтому
 * параметр userId больше не используется (оставлен для совместимости).
 */
export async function insertTemplateItems(
  templateId: string,
  clientPositionId: string,
  _userId?: string
): Promise<InsertTemplateResult> {
  const res = await apiFetch<{ data: InsertTemplateResult }>(
    `/api/v1/templates/${encodeURIComponent(templateId)}/insert-into-position`,
    {
      method: 'POST',
      timeoutMs: 0,
      body: JSON.stringify({ client_position_id: clientPositionId }),
    }
  );
  return res.data;
}
