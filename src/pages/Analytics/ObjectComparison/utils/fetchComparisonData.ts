// Загрузка данных сравнения объектов: строки BOQ с коммерческими суммами,
// объёмы категорий и примечания инженеров.
//
// Вынесено из useComparisonData.ts вместе со сборкой иерархии — файл хука
// упёрся в лимит 600 строк.
import type { CurrencyType } from '../../../../lib/types';
import { dedupeCurrencies } from '../../../../utils/boq/currencyGuard';
import { listAllBoqItemsForTender } from '../../../../lib/api/fi';
import { listDetailCostCategoriesWithCategory } from '../../../../lib/api/costs';
import { apiFetch } from '../../../../lib/api/client';
import {
  loadLiveCommercialCalculationContext,
  calculateLiveCommercialAmounts,
  resetLiveCommercialCalculationCache,
} from '../../../../utils/boq/liveCommercialCalculation';
import type { BoqItemForComparison, NotesMap, VolumeMaps } from '../types';

interface CostVolumeRow {
  detail_cost_category_id: string | null;
  volume: number | null;
  group_key: string | null;
}

export async function fetchVolumes(tenderId: string): Promise<VolumeMaps> {
  const res = await apiFetch<{ data: CostVolumeRow[] }>(
    `/api/v1/tenders/${encodeURIComponent(tenderId)}/cost-volumes`,
  );

  const detailMap = new Map<string, number>();
  const groupMap = new Map<string, number>();
  for (const v of (res.data || [])) {
    if (v.detail_cost_category_id) {
      detailMap.set(v.detail_cost_category_id, v.volume || 0);
    } else if (v.group_key) {
      groupMap.set(v.group_key, v.volume || 0);
    }
  }
  return { detailMap, groupMap };
}

// ВНИМАНИЕ: вызывать ПОСЛЕДОВАТЕЛЬНО по тендерам (не через Promise.all). Кэш
// коэффициентов в calculateBoqItemCost — module-level и ключуется только по
// типу/исключению/НДС (без tenderId), поэтому конкурентный расчёт тендеров с
// разными тактиками привёл бы к загрязнению. Сброс в начале каждого тендера +
// последовательный вызов гарантируют корректность.
export async function fetchBoqItems(
  tenderId: string,
): Promise<{ items: BoqItemForComparison[]; missingCurrencies: CurrencyType[] }> {
  // Go BFF: boq-items-flat для тендера + справочник детальных категорий
  // (с присоединённой родительской категорией) + контекст для live-расчёта
  // коммерческих стоимостей. Соединяем по detail_cost_category_id. Сохраняем
  // семантику прежних !inner-джойнов: берём только элементы с
  // detail_cost_category_id, который резолвится.
  const [items, detailCats, calcContext] = await Promise.all([
    listAllBoqItemsForTender(tenderId),
    listDetailCostCategoriesWithCategory(),
    loadLiveCommercialCalculationContext(tenderId),
  ]);

  const catMap = new Map<
    string,
    { name: string | null; location: string | null; cost_categories: { name: string | null } | null }
  >();
  for (const dc of detailCats) {
    catMap.set(dc.id, {
      name: dc.name ?? null,
      location: (dc as { location?: string | null }).location ?? null,
      cost_categories: dc.cost_categories ? { name: dc.cost_categories.name ?? null } : null,
    });
  }

  // Сбрасываем кэш коэффициентов перед расчётом этого тендера.
  resetLiveCommercialCalculationCache();

  const out: BoqItemForComparison[] = [];
  const missing: CurrencyType[] = [];
  for (const i of items) {
    const detailId = i.detail_cost_category_id ?? null;
    if (!detailId) continue;
    const cat = catMap.get(detailId);
    if (!cat) continue; // эквивалент detail_cost_categories!inner
    // Коммерческие стоимости считаем на лету по тактике тендера (как на странице
    // «Финансовые показатели»), не полагаясь на материализованные
    // total_commercial_* — они могут отставать до серверного авто-пересчёта.
    const live = calculateLiveCommercialAmounts(
      i as unknown as Parameters<typeof calculateLiveCommercialAmounts>[0],
      calcContext,
    );
    // Fail-closed: нет курса → элемент недоступен; валюту фиксируем, весь тендер
    // будет помечен как «не рассчитан» (см. runLoad).
    if (live.unavailable) {
      missing.push(...live.missingCurrencies);
      continue;
    }
    out.push({
      total_amount: i.total_amount ?? null,
      boq_item_type: i.boq_item_type ?? null,
      total_commercial_material_cost: live.materialCost,
      total_commercial_work_cost: live.workCost,
      detail_cost_category_id: detailId,
      detail_cost_categories: cat,
      client_positions: { tender_id: tenderId },
    });
  }
  return { items: out, missingCurrencies: dedupeCurrencies(missing) };
}

interface ComparisonNoteRow {
  tender_id_1: string;
  tender_id_2: string;
  cost_category_name: string;
  detail_category_key: string | null;
  note: string;
}

export async function fetchNotes(tenderId1: string, tenderId2: string): Promise<NotesMap> {
  const res = await apiFetch<{ data: ComparisonNoteRow[] }>(
    `/api/v1/comparison-notes?tender_id_1=${encodeURIComponent(tenderId1)}&tender_id_2=${encodeURIComponent(tenderId2)}`,
  );
  const data = res.data || [];

  const map = new Map<string, string>();
  const exactOrderRows = data.filter(r => r.tender_id_1 === tenderId1 && r.tender_id_2 === tenderId2);
  const reversedOrderRows = data.filter(r => r.tender_id_1 === tenderId2 && r.tender_id_2 === tenderId1);

  for (const row of exactOrderRows) {
    const key = row.detail_category_key || `main__${row.cost_category_name}`;
    if (row.note) map.set(key, row.note);
  }
  for (const row of reversedOrderRows) {
    const key = row.detail_category_key || `main__${row.cost_category_name}`;
    if (row.note && !map.has(key)) map.set(key, row.note);
  }
  return map;
}
