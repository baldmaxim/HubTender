/**
 * Применение тактик наценок к элементам BOQ — Go BFF only.
 *
 * Живой путь — applyTacticToTender (используется Commerce). Легаси-функции
 * applyTacticToBoqItem / applyTacticToPosition / updatePositionTotals /
 * recalculateAfterParameterChange удалены: наружу экспонировался и
 * использовался только applyTacticToTender (см. useCommerceActions); они
 * нигде не вызывались и тянули прямой Supabase + клиентский пересчёт
 * client_positions (серверного эквивалента нет — но он и не нужен, т.к.
 * мёртвый код). См. docs/yandex-migration/26.
 */

import type { BoqItem } from '../../lib/supabase';
import { bulkUpdateCommercial } from '../../lib/api/boq';
import { listAllBoqItemsForTender } from '../../lib/api/fi';
import { getMarkupTactic, getTenderMarkupTacticId } from '../../lib/api/markup';
import { loadMarkupParameters } from './parameters';
import {
  loadPricingDistribution,
  calculateBoqItemCost,
  loadSubcontractGrowthExclusions,
  resetTypeCoefficientsCache,
  type TacticApplicationResult
} from './calculation';

type RecalculationBoqItem = Pick<
  BoqItem,
  'id' |
  'tender_id' |
  'client_position_id' |
  'sort_number' |
  'boq_item_type' |
  'material_type' |
  'total_amount' |
  'detail_cost_category_id'
>;

type BulkCommercialUpdateRow = Pick<
  BoqItem,
  'id'
> & Pick<
  BoqItem,
  'commercial_markup' |
  'total_commercial_material_cost' |
  'total_commercial_work_cost'
>;

const BULK_UPSERT_BATCH_SIZE = 1000;

/** Загружает BOQ-элементы тендера через Go BFF (boq-items-flat). */
async function loadBoqItemsForTender(tenderId: string): Promise<RecalculationBoqItem[]> {
  const items = await listAllBoqItemsForTender(tenderId);
  return items.map((i) => ({
    id: i.id,
    tender_id: i.tender_id,
    client_position_id: i.client_position_id,
    sort_number: i.sort_number,
    boq_item_type: i.boq_item_type,
    material_type: i.material_type,
    total_amount: i.total_amount,
    detail_cost_category_id: i.detail_cost_category_id,
  }));
}

/**
 * Bulk-обновление commercial-полей через Go BFF
 * (/api/v1/items/bulk-commercial — один pgx.Tx + пересчёт grand-total
 * тендера на сервере). Supabase-fallback убран (Go-only).
 */
async function bulkUpdateBoqItems(
  rows: BulkCommercialUpdateRow[]
): Promise<{ successCount: number; errors: string[] }> {
  let successCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BULK_UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + BULK_UPSERT_BATCH_SIZE);
    try {
      successCount += await bulkUpdateCommercial(batch);
    } catch (err) {
      errors.push(
        `Ошибка bulk-обновления: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`
      );
    }
  }

  return { successCount, errors };
}

function buildBulkCommercialUpdateRow(
  item: Pick<BoqItem, 'id'>,
  result: { materialCost: number; workCost: number; markupCoefficient: number }
): BulkCommercialUpdateRow {
  return {
    id: item.id,
    commercial_markup: result.markupCoefficient,
    total_commercial_material_cost: result.materialCost,
    total_commercial_work_cost: result.workCost,
  };
}

/**
 * Применяет тактику наценки ко всем элементам тендера.
 * @param tenderId ID тендера
 * @param tacticId ID тактики (если не указан — берётся из тендера)
 * @param boqItems предзагруженные элементы (опц.)
 */
export async function applyTacticToTender(
  tenderId: string,
  tacticId?: string,
  boqItems?: RecalculationBoqItem[]
): Promise<TacticApplicationResult> {
  try {
    // Сбрасываем кэш коэффициентов перед пересчётом
    resetTypeCoefficientsCache();

    // Если тактика не указана — получаем её из тендера (Go)
    if (!tacticId) {
      const tid = await getTenderMarkupTacticId(tenderId);
      if (!tid) {
        return {
          success: false,
          errors: ['У тендера не задана тактика наценок']
        };
      }
      tacticId = tid;
    }

    // Загружаем тактику и параметры (всё через Go-хелперы)
    const [tactic, markupParameters, pricingDistribution, exclusions] = await Promise.all([
      getMarkupTactic(tacticId),
      loadMarkupParameters(tenderId),
      loadPricingDistribution(tenderId),
      loadSubcontractGrowthExclusions(tenderId)
    ]);

    if (!tactic) {
      return {
        success: false,
        errors: [`Тактика наценок не найдена: ${tacticId}`]
      };
    }

    // Go-хелпер отдаёт строгий MarkupTactic (sequences: MarkupSequences);
    // calculateBoqItemCost ждёт структурно-совместимый локальный тип
    // (Record<string, MarkupStep[]>). Рантайм идентичен.
    const tacticForCalc = tactic as unknown as Parameters<typeof calculateBoqItemCost>[1];

    const allBoqItems = boqItems || await loadBoqItemsForTender(tenderId);

    if (allBoqItems.length === 0) {
      return {
        success: true,
        updatedCount: 0,
        errors: ['Нет элементов для обработки в тендере']
      };
    }

    const updateRows: BulkCommercialUpdateRow[] = [];
    const errors: string[] = [];

    for (const item of allBoqItems) {
      const result = calculateBoqItemCost(item, tacticForCalc, markupParameters, pricingDistribution, exclusions);

      if (!result) {
        errors.push(`Элемент ${item.id}: отсутствует последовательность для типа "${item.boq_item_type}"`);
        continue;
      }

      updateRows.push(buildBulkCommercialUpdateRow(item, result));
    }

    const { successCount, errors: updateErrors } = await bulkUpdateBoqItems(updateRows);
    errors.push(...updateErrors);

    return {
      success: successCount > 0,
      updatedCount: successCount,
      errors: errors.length > 0 ? errors : undefined
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return {
      success: false,
      errors: [`Ошибка применения тактики к тендеру: ${errorMessage}`]
    };
  }
}
