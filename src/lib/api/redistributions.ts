import type { RedistributionRule } from '../types';
import { apiFetch } from './client';

// Строка снимка перераспределения. С этапа 0.1.2.3a — ВСЕГДА server-generated:
// клиент не передаёт финансовые значения, endpoint save принимает только rules.
export interface RedistributionRecord {
  boq_item_id: string;
  original_work_cost: number;
  deducted_amount: number;
  added_amount: number;
  final_work_cost: number;
}

// Статус сохранённого снимка (GET):
//  - calculated — server-authoritative (schema_version>=2, source=server);
//  - requires_recalculation — legacy клиентский снимок: results нельзя
//    применять в Commerce/FI/экспортах, нужен новый серверный save;
//  - empty — снимка нет.
export type RedistributionSnapshotStatus =
  | 'calculated'
  | 'requires_recalculation'
  | 'empty';

export interface SaveRedistributionInput {
  tenderId: string;
  tacticId: string;
  rules: RedistributionRule;
}

export interface SavedRedistribution {
  saved_count: number;
  results: RedistributionRecord[];
  total_deducted: number;
  total_added: number;
  is_balanced: boolean;
  redistribution_rules: RedistributionRule | null;
  calculation_source: string;
  schema_version: number;
  position_deltas?: Record<string, number>;
}

export interface LoadedRedistribution {
  results: RedistributionRecord[];
  redistribution_rules: RedistributionRule | null;
  status: RedistributionSnapshotStatus;
}

/**
 * Загрузить сохранённый снимок перераспределения для (tenderId, tacticId).
 * Go: GET /api/v1/redistributions?tender_id=&markup_tactic_id= — строки
 * результата + rules JSONB + status. Возвращает null, если результатов нет.
 */
export async function loadRedistributionResults(
  tenderId: string,
  tacticId: string,
): Promise<LoadedRedistribution | null> {
  const res = await apiFetch<{
    data: {
      results: RedistributionRecord[];
      redistribution_rules: RedistributionRule | null;
      status: RedistributionSnapshotStatus;
    };
  }>(
    `/api/v1/redistributions?tender_id=${encodeURIComponent(tenderId)}&markup_tactic_id=${encodeURIComponent(tacticId)}`,
  );
  if (!res.data || res.data.results.length === 0) return null;
  return {
    results: res.data.results,
    redistribution_rules: res.data.redistribution_rules ?? null,
    status: res.data.status ?? 'requires_recalculation',
  };
}

/**
 * Сохранить перераспределение. Этап 0.1.2.3a: клиент передаёт ТОЛЬКО правила
 * (deductions/targets/position_adjustments). Сервер в одной транзакции
 * материализует текущие commercial-стоимости, загружает весь BOQ тендера,
 * валидирует правила, считает результат через backend/internal/calc и
 * атомарно сохраняет ПОЛНЫЙ server-generated набор. Ответ содержит серверные
 * results — caller обязан заменить ими локальный preview.
 *
 * Никакие records / original_work_cost / deducted_amount / added_amount /
 * final_work_cost с клиента не отправляются и сервером не принимаются.
 */
export async function saveRedistributionResults(
  input: SaveRedistributionInput,
): Promise<SavedRedistribution> {
  const { tenderId, tacticId, rules } = input;

  const res = await apiFetch<{ data: SavedRedistribution }>(
    '/api/v1/redistributions/save',
    {
      method: 'POST',
      body: JSON.stringify({
        tender_id: tenderId,
        markup_tactic_id: tacticId,
        rules,
      }),
      timeoutMs: 0,
    },
  );
  return res.data;
}
