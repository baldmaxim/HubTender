// Positions-with-costs helper with Go BFF / Supabase fallback (Phase 4d).
// Routes to GET /api/v1/tenders/:id/positions/with-costs (which ports the
// public.get_positions_with_costs RPC) when VITE_API_POSITIONS_ENABLED=true.
import { apiFetch } from './client';

// Exported type — consumers usually redefine it inline; this is the authoritative shape.
export interface PositionWithCostsRow {
  id: string;
  tender_id: string;
  position_number: number;
  unit_code: string | null;
  volume: number | null;
  client_note: string | null;
  item_no: string | null;
  work_name: string;
  manual_volume: number | null;
  manual_note: string | null;
  hierarchy_level: number | null;
  is_additional: boolean | null;
  parent_position_id: string | null;
  total_material: number | null;
  total_works: number | null;
  material_cost_per_unit: number | null;
  work_cost_per_unit: number | null;
  total_commercial_material: number | null;
  total_commercial_work: number | null;
  total_commercial_material_per_unit: number | null;
  total_commercial_work_per_unit: number | null;
  created_at: string;
  updated_at: string;
  base_total: number | null;
  commercial_total: number | null;
  material_cost_total: number | null;
  work_cost_total: number | null;
  markup_percentage: number | null;
  items_count: number | null;
}

/**
 * Fetch positions-with-costs aggregate for a tender.
 * Go path: single request, ~30s server cache + singleflight.
 * Supabase path: paginated RPC calls in 1000-row chunks.
 */
export async function fetchPositionsWithCosts(
  tenderId: string,
  opts?: { fresh?: boolean },
): Promise<PositionWithCostsRow[]> {
  const res = await apiFetch<{ data: PositionWithCostsRow[] }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/positions/with-costs`,
    {
      cacheKey: `positions:${tenderId}`,
      // На realtime-рефетче минуем серверный 30-сек кэш, чтобы примечание ГП
      // было таким же свежим, как сумма/строки (boq-items-flat не кэшируется).
      ...(opts?.fresh ? { headers: { 'Cache-Control': 'no-cache' } } : {}),
    }
  );
  return res.data ?? [];
}

/**
 * Атомарно создать дополнительную работу (is_additional child).
 * Go: POST /api/v1/positions/additional — read parent + расчёт
 * десятичного суффикса (5.1, 5.2…) + insert в одной pgx.Tx.
 */
export async function createAdditionalPosition(input: {
  parent_position_id: string;
  tender_id: string;
  work_name: string;
  unit_code?: string | null;
  manual_volume?: number | null;
  manual_note?: string | null;
}): Promise<string> {
  const res = await apiFetch<{ data: { id: string } }>('/api/v1/positions/additional', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data.id;
}

export interface BoqPreviewRow {
  id: string;
  client_position_id: string;
  boq_item_type: string | null;
  quantity: number | null;
  total_amount: number | null;
  work_names: { name: string } | null;
  material_names: { name: string } | null;
}

/** Существующие boq_items (subset + name embeds) по позициям для предпросмотра.
 *  POST с JSON-body: на mass-import тендеров с сотнями позиций GET-вариант
 *  ловил 414 на прод-прокси (Sentry HUBTENDER-WEB-1). */
export async function listBoqPreviewByPositions(
  positionIds: string[],
): Promise<BoqPreviewRow[]> {
  if (positionIds.length === 0) return [];
  const res = await apiFetch<{ data: BoqPreviewRow[] }>(
    '/api/v1/positions/boq-preview',
    { method: 'POST', body: JSON.stringify({ position_ids: positionIds }) },
  );
  return res.data ?? [];
}

/** Атомарная bulk-вставка позиций (BOQ-upload). */
export interface BulkPositionInsert {
  tender_id: string;
  position_number: number;
  work_name: string;
  unit_code?: string | null;
  volume?: number | null;
  client_note?: string | null;
  item_no?: string | null;
  hierarchy_level?: number | null;
  is_additional?: boolean | null;
  parent_position_id?: string | null;
}

export async function bulkInsertPositions(
  tenderId: string,
  positions: BulkPositionInsert[],
): Promise<number> {
  if (positions.length === 0) return 0;
  const res = await apiFetch<{ data: { inserted: number } }>('/api/v1/positions/bulk', {
    method: 'POST',
    body: JSON.stringify({ tender_id: tenderId, positions }),
    timeoutMs: 0,
  });
  return res.data.inserted;
}

/** Одна позиция + tenders(usd_rate,eur_rate,cny_rate) embed. */
export async function getPositionWithTender(positionId: string): Promise<Record<string, unknown>> {
  const res = await apiFetch<{ data: Record<string, unknown> }>(
    `/api/v1/positions/${encodeURIComponent(positionId)}/with-tender`,
    { cache: 'no-store' },
  );
  return res.data;
}

/** boq_items позиции с вложенными embed'ами (work_names, material_names,
 *  parent_work.work_names, detail_cost_categories+cost_categories). */
export async function listBoqItemsFullByTender(tenderId: string): Promise<Record<string, unknown>[]> {
  const res = await apiFetch<{ data: Record<string, unknown>[] }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/boq-items-full`,
    { cache: 'no-store', timeoutMs: 0 },
  );
  return res.data ?? [];
}

export async function listBoqItemsFullByPosition(positionId: string): Promise<Record<string, unknown>[]> {
  const res = await apiFetch<{ data: Record<string, unknown>[] }>(
    `/api/v1/positions/${encodeURIComponent(positionId)}/boq-items-full`,
    { cache: 'no-store' },
  );
  return res.data ?? [];
}

/** Пересчитать total_material/total_works позиции по её boq_items (idempotent). */
export async function recomputePositionTotals(
  positionId: string,
  tenderId?: string | null,
): Promise<void> {
  await apiFetch<undefined>(
    `/api/v1/positions/${encodeURIComponent(positionId)}/recompute-totals`,
    { method: 'POST', body: JSON.stringify({ tender_id: tenderId ?? undefined }) },
  );
}

/** Точечный PATCH полей позиции: manual_volume/manual_note/work_name/unit_code. */
export async function updatePositionFields(
  positionId: string,
  fields: {
    manual_volume?: number | null;
    manual_note?: string | null;
    work_name?: string | null;
    unit_code?: string | null;
  },
  tenderId?: string | null,
): Promise<void> {
  await apiFetch<undefined>(
    `/api/v1/positions/${encodeURIComponent(positionId)}/fields`,
    { method: 'PATCH', body: JSON.stringify({ ...fields, tender_id: tenderId ?? undefined }) },
  );
}

/** Установить manual_note на одну/несколько позиций (вставка примечания ГП). */
export async function updatePositionsNote(
  positionIds: string[],
  manualNote: string,
  tenderId?: string | null,
): Promise<void> {
  await apiFetch<undefined>('/api/v1/positions/note', {
    method: 'PATCH',
    body: JSON.stringify({
      position_ids: positionIds,
      manual_note: manualNote,
      tender_id: tenderId ?? undefined,
    }),
    // Без таймаута: на крупных тендерах под нагрузкой запись может ждать
    // коннект/локи дольше 10 c (дефолт DEFAULT_FETCH_TIMEOUT_MS), иначе
    // AbortSignal обрывает запрос → ложная ошибка вставки примечания.
    timeoutMs: 0,
  });
}

/** Удалить boq_items позиций и обнулить их итоги (одна pgx.Tx). */
export async function clearPositionsBoq(
  positionIds: string[],
  tenderId?: string | null,
): Promise<void> {
  await apiFetch<undefined>('/api/v1/positions/clear-boq', {
    method: 'POST',
    body: JSON.stringify({ position_ids: positionIds, tender_id: tenderId ?? undefined }),
    timeoutMs: 0, // bulk-tx: на крупных тендерах не укладывается в дефолтные 10 c
  });
}

/** Сдвинуть hierarchy_level на delta (пол 0) для позиций. */
export async function shiftPositionsLevel(
  positionIds: string[],
  delta: number,
  tenderId?: string | null,
): Promise<void> {
  await apiFetch<undefined>('/api/v1/positions/level', {
    method: 'PATCH',
    body: JSON.stringify({
      position_ids: positionIds,
      delta,
      tender_id: tenderId ?? undefined,
    }),
    timeoutMs: 0, // bulk-write: не обрывать по 10-сек таймауту на крупных тендерах
  });
}

/**
 * Атомарно удалить позиции заказчика вместе с их boq_items.
 * Go: POST /api/v1/positions/bulk-delete — одна pgx.Tx
 * (delete boq_items → delete client_positions).
 */
export async function bulkDeletePositions(
  positionIds: string[],
  tenderId?: string | null,
): Promise<void> {
  await apiFetch<undefined>('/api/v1/positions/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ position_ids: positionIds, tender_id: tenderId ?? undefined }),
  });
}
