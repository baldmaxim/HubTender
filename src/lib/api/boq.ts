// BOQ items helpers (Go BFF).
// Коммерческая материализация (bulkUpdateCommercial → PATCH /items/bulk-commercial)
// удалена с фронта: пересчёт коммерческих стоимостей выполняется авторитетно на
// сервере (Go BFF авто-пересчёт по изменению входных данных).
import { apiFetch } from './client';

/**
 * Каскадно пересчитать quantity+total_amount у всех materials-детей работы.
 * Go: одна pgx.Tx с audit-строкой на каждый ребёнок.
 */
export async function recomputeLinkedMaterials(workId: string): Promise<number> {
  const res = await apiFetch<{ data: { updated: number } }>(
    `/api/v1/items/${encodeURIComponent(workId)}/recompute-linked-materials`,
    { method: 'POST' },
  );
  return res.data.updated;
}

export interface CopyPositionItemsResult {
  works_count: number;
  materials_count: number;
  total_copied: number;
}

/** Скопировать ВСЕ boq_items из исходной позиции в целевую (одна tx + audit). */
export async function copyPositionItems(
  sourcePositionId: string,
  targetPositionId: string,
): Promise<CopyPositionItemsResult> {
  const res = await apiFetch<{ data: CopyPositionItemsResult }>(
    `/api/v1/positions/${encodeURIComponent(targetPositionId)}/copy-from`,
    {
      method: 'POST',
      body: JSON.stringify({ source_position_id: sourcePositionId }),
    },
  );
  return res.data;
}

// ─── audit history ──────────────────────────────────────────────────────────

export interface BoqAuditApiRow {
  id: string;
  boq_item_id: string;
  operation_type: string;
  changed_at: string;
  changed_by: string | null;
  changed_fields: string[] | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  user: { id: string; full_name: string | null; email: string | null } | null;
}

export interface BoqAuditListParams {
  positionId: string;
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  operationType?: string;
}

/**
 * boq_items_audit по позиции (JSONB-filter new_data/old_data → client_position_id)
 * + user embed; опциональные фильтры даты/пользователя/операции.
 */
export async function listBoqAuditByPosition(params: BoqAuditListParams): Promise<BoqAuditApiRow[]> {
  const qs = new URLSearchParams({ position_id: params.positionId });
  if (params.dateFrom) qs.set('date_from', params.dateFrom);
  if (params.dateTo) qs.set('date_to', params.dateTo);
  if (params.userId) qs.set('user_id', params.userId);
  if (params.operationType) qs.set('operation_type', params.operationType);
  const res = await apiFetch<{ data: BoqAuditApiRow[] }>(
    `/api/v1/boq-audit?${qs.toString()}`,
  );
  return res.data ?? [];
}
