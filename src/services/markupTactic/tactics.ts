/**
 * Применение тактик наценок к элементам BOQ и позициям
 */

import { supabase } from '../../lib/supabase';
import type { BoqItem } from '../../lib/supabase';
import { validateMarkupSequence } from '../../utils/markupCalculator';
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

async function loadBoqItemsForTender(tenderId: string): Promise<RecalculationBoqItem[]> {
  const allBoqItems: RecalculationBoqItem[] = [];
  let from = 0;
  const loadBatchSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('boq_items')
      .select(`
        id,
        tender_id,
        client_position_id,
        sort_number,
        boq_item_type,
        material_type,
        total_amount,
        detail_cost_category_id
      `)
      .eq('tender_id', tenderId)
      .order('sort_number')
      .order('id')
      .range(from, from + loadBatchSize - 1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    allBoqItems.push(...(data as RecalculationBoqItem[]));

    if (data.length < loadBatchSize) {
      break;
    }

    from += loadBatchSize;
  }

  return allBoqItems;
}

async function fallbackBatchUpdateBoqItems(rows: BulkCommercialUpdateRow[]): Promise<{ successCount: number; errors: string[] }> {
  let successCount = 0;
  const errors: string[] = [];
  const fallbackBatchSize = 50;

  for (let i = 0; i < rows.length; i += fallbackBatchSize) {
    const batch = rows.slice(i, i + fallbackBatchSize);
    const results = await Promise.allSettled(
      batch.map((row) =>
        supabase
          .from('boq_items')
          .update({
            commercial_markup: row.commercial_markup,
            total_commercial_material_cost: row.total_commercial_material_cost,
            total_commercial_work_cost: row.total_commercial_work_cost,
          })
          .eq('id', row.id)
      )
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && !result.value.error) {
        successCount++;
        return;
      }

      const error = result.status === 'rejected' ? result.reason : result.value.error;
      if (errors.length < 5) {
        errors.push(`Элемент ${batch[index].id}: ${error?.message || 'Ошибка обновления'}`);
      }
    });
  }

  return { successCount, errors };
}

async function bulkUpdateBoqItems(rows: BulkCommercialUpdateRow[]): Promise<{ successCount: number; errors: string[] }> {
  let successCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BULK_UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + BULK_UPSERT_BATCH_SIZE);
    const { data, error } = await supabase.rpc('bulk_update_boq_items_commercial_costs', {
      p_rows: batch,
    });

    if (error) {
      console.warn('bulk_update_boq_items_commercial_costs RPC is unavailable, falling back to batched updates:', error);
      console.warn('RPC error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return fallbackBatchUpdateBoqItems(rows);
    }

    successCount += Number(data) || 0;
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
 * Применяет тактику наценки к одному элементу BOQ
 * @param itemId ID элемента BOQ
 * @param tacticId ID тактики наценок
 * @param markupParameters Параметры наценок (опционально, будут загружены если не переданы)
 * @returns Результат применения тактики
 */
export async function applyTacticToBoqItem(
  itemId: string,
  tacticId: string,
  markupParameters?: Map<string, number>
): Promise<TacticApplicationResult> {
  try {
    // Загружаем элемент BOQ
    const { data: boqItem, error: itemError } = await supabase
      .from('boq_items')
      .select('*')
      .eq('id', itemId)
      .single();

    if (itemError || !boqItem) {
      return {
        success: false,
        errors: [`Элемент BOQ не найден: ${itemId}`]
      };
    }

    // Загружаем тактику наценок
    const { data: tactic, error: tacticError } = await supabase
      .from('markup_tactics')
      .select('*')
      .eq('id', tacticId)
      .single();

    if (tacticError || !tactic) {
      return {
        success: false,
        errors: [`Тактика наценок не найдена: ${tacticId}`]
      };
    }

    // Загружаем параметры наценок, если не переданы
    if (!markupParameters) {
      const { data: tender } = await supabase
        .from('tenders')
        .select('id')
        .eq('id', boqItem.tender_id)
        .single();

      if (!tender) {
        return {
          success: false,
          errors: ['Тендер не найден для элемента BOQ']
        };
      }

      markupParameters = await loadMarkupParameters(tender.id);
    }

    // Получаем последовательность операций для типа элемента
    const sequence = tactic.sequences[boqItem.boq_item_type];
    if (!sequence || sequence.length === 0) {
      return {
        success: false,
        errors: [`Отсутствует последовательность наценок для типа "${boqItem.boq_item_type}"`]
      };
    }

    // Валидируем последовательность
    const validationErrors = validateMarkupSequence(sequence);
    if (validationErrors.length > 0) {
      return {
        success: false,
        errors: validationErrors
      };
    }

    // Загружаем настройки ценообразования для тендера
    const pricingDistribution = await loadPricingDistribution(boqItem.tender_id);

    // Загружаем исключения роста субподряда
    const exclusions = await loadSubcontractGrowthExclusions(boqItem.tender_id);

    // Выполняем расчет
    const result = calculateBoqItemCost(boqItem, tactic, markupParameters, pricingDistribution, exclusions);
    if (!result) {
      return {
        success: false,
        errors: ['Ошибка расчета элемента']
      };
    }

    // Готовим данные для обновления
    const updateData = {
      commercial_markup: result.markupCoefficient,
      total_commercial_material_cost: result.materialCost,
      total_commercial_work_cost: result.workCost,
      updated_at: new Date().toISOString()
    };

    // Обновляем элемент BOQ
    const { error: updateError } = await supabase
      .from('boq_items')
      .update(updateData)
      .eq('id', itemId);

    if (updateError) {
      return {
        success: false,
        errors: [`Ошибка обновления элемента: ${updateError.message}`]
      };
    }

    return {
      success: true,
      updatedCount: 1,
      details: [{
        itemId,
        commercialCost: result.materialCost + result.workCost,
        markupCoefficient: result.markupCoefficient
      }]
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return {
      success: false,
      errors: [`Ошибка применения тактики: ${errorMessage}`]
    };
  }
}

/**
 * Применяет тактику наценки ко всем элементам позиции заказчика
 * @param positionId ID позиции заказчика
 * @param tacticId ID тактики наценок
 * @returns Результат применения тактики
 */
export async function applyTacticToPosition(
  positionId: string,
  tacticId: string
): Promise<TacticApplicationResult> {
  try {
    // Загружаем все элементы позиции
    const { data: boqItems, error: itemsError } = await supabase
      .from('boq_items')
      .select('*')
      .eq('client_position_id', positionId)
      .order('sort_number');

    if (itemsError || !boqItems) {
      return {
        success: false,
        errors: [`Ошибка загрузки элементов позиции: ${itemsError?.message}`]
      };
    }

    if (boqItems.length === 0) {
      return {
        success: true,
        updatedCount: 0,
        errors: ['Нет элементов для обработки в позиции']
      };
    }

    // Загружаем тактику и параметры один раз для всех элементов
    const tenderId = boqItems[0].tender_id;
    const [
      { data: tactic, error: tacticError },
      markupParameters,
      pricingDistribution,
      exclusions
    ] = await Promise.all([
      supabase
        .from('markup_tactics')
        .select('*')
        .eq('id', tacticId)
        .single(),
      loadMarkupParameters(tenderId),
      loadPricingDistribution(tenderId),
      loadSubcontractGrowthExclusions(tenderId)
    ]);

    if (tacticError || !tactic) {
      return {
        success: false,
        errors: [`Тактика наценок не найдена: ${tacticId}`]
      };
    }

    // Применяем тактику к каждому элементу
    const details: TacticApplicationResult['details'] = [];
    const errors: string[] = [];
    const updateRows: BulkCommercialUpdateRow[] = [];

    for (const item of boqItems) {
      const result = calculateBoqItemCost(item, tactic, markupParameters, pricingDistribution, exclusions);

      if (!result) {
        errors.push(`Элемент ${item.id}: отсутствует последовательность для типа "${item.boq_item_type}"`);
        continue;
      }

      updateRows.push(buildBulkCommercialUpdateRow(item, result));
      details?.push({
        itemId: item.id,
        commercialCost: result.materialCost + result.workCost,
        markupCoefficient: result.markupCoefficient
      });
    }

    const { successCount, errors: updateErrors } = await bulkUpdateBoqItems(updateRows);
    errors.push(...updateErrors);

    // Обновляем итоги в client_positions
    await updatePositionTotals(positionId);

    return {
      success: successCount > 0,
      updatedCount: successCount,
      errors: errors.length > 0 ? errors : undefined,
      details
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return {
      success: false,
      errors: [`Ошибка применения тактики к позиции: ${errorMessage}`]
    };
  }
}

/**
 * Применяет тактику наценки ко всем элементам тендера
 * @param tenderId ID тендера
 * @param tacticId ID тактики наценок (если не указан, используется тактика из тендера)
 * @returns Результат применения тактики
 */
export async function applyTacticToTender(
  tenderId: string,
  tacticId?: string,
  boqItems?: RecalculationBoqItem[]
): Promise<TacticApplicationResult> {
  try {
    // Сбрасываем кэш коэффициентов перед пересчётом
    resetTypeCoefficientsCache();

    // Если тактика не указана, получаем ее из тендера
    if (!tacticId) {
      const { data: tender, error: tenderError } = await supabase
        .from('tenders')
        .select('markup_tactic_id')
        .eq('id', tenderId)
        .single();

      if (tenderError || !tender?.markup_tactic_id) {
        return {
          success: false,
          errors: ['У тендера не задана тактика наценок']
        };
      }

      tacticId = tender.markup_tactic_id;
    }

    // Загружаем тактику и параметры один раз для всего тендера
    const [
      { data: tactic, error: tacticError },
      markupParameters,
      pricingDistribution,
      exclusions
    ] = await Promise.all([
      supabase
        .from('markup_tactics')
        .select('*')
        .eq('id', tacticId)
        .single(),
      loadMarkupParameters(tenderId),
      loadPricingDistribution(tenderId),
      loadSubcontractGrowthExclusions(tenderId)
    ]);

    if (tacticError || !tactic) {
      return {
        success: false,
        errors: [`Тактика наценок не найдена: ${tacticId}`]
      };
    }

    const allBoqItems = boqItems || await loadBoqItemsForTender(tenderId);

    if (allBoqItems.length === 0) {
      return {
        success: true,
        updatedCount: 0,
        errors: ['Нет элементов для обработки в тендере']
      };
    }

    // Обрабатываем все элементы и готовим bulk upsert
    const updateRows: BulkCommercialUpdateRow[] = [];
    const errors: string[] = [];

    for (const item of allBoqItems) {
      const result = calculateBoqItemCost(item, tactic, markupParameters, pricingDistribution, exclusions);

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

/**
 * Обновляет итоговые суммы в позиции заказчика
 * @param positionId ID позиции
 */
async function updatePositionTotals(positionId: string): Promise<void> {
  try {
    // Загружаем все элементы позиции с батчингом
    let boqItems: any[] = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('boq_items')
        .select('total_commercial_material_cost, total_commercial_work_cost')
        .eq('client_position_id', positionId)
        .order('id')  // Сортировка по уникальному ключу для детерминированной пагинации
        .range(from, from + batchSize - 1);

      if (error) {
        console.error('Ошибка загрузки элементов для расчета итогов:', error);
        return;
      }

      if (data && data.length > 0) {
        boqItems = [...boqItems, ...data];
        from += batchSize;
        hasMore = data.length === batchSize;
      } else {
        hasMore = false;
      }
    }

    if (boqItems.length === 0) {
      return;
    }

    // Суммируем коммерческие стоимости
    let totalCommercialMaterial = 0;
    let totalCommercialWork = 0;

    for (const item of boqItems) {
      totalCommercialMaterial += item.total_commercial_material_cost || 0;
      totalCommercialWork += item.total_commercial_work_cost || 0;
    }

    // Обновляем позицию
    const { error: updateError } = await supabase
      .from('client_positions')
      .update({
        total_commercial_material: totalCommercialMaterial,
        total_commercial_work: totalCommercialWork,
        updated_at: new Date().toISOString()
      })
      .eq('id', positionId);

    if (updateError) {
      console.error('Ошибка обновления итогов позиции:', updateError);
    }

  } catch (error) {
    console.error('Ошибка в updatePositionTotals:', error);
  }
}

/**
 * Пересчитывает коммерческие стоимости при изменении параметров наценок
 * @param tenderId ID тендера
 * @returns Результат пересчета
 */
export async function recalculateAfterParameterChange(
  tenderId: string
): Promise<TacticApplicationResult> {
  try {
    // Получаем тактику тендера
    const { data: tender, error: tenderError } = await supabase
      .from('tenders')
      .select('markup_tactic_id')
      .eq('id', tenderId)
      .single();

    if (tenderError || !tender?.markup_tactic_id) {
      return {
        success: false,
        errors: ['У тендера не задана тактика наценок']
      };
    }

    // Применяем тактику ко всему тендеру
    return await applyTacticToTender(tenderId, tender.markup_tactic_id);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return {
      success: false,
      errors: [`Ошибка пересчета: ${errorMessage}`]
    };
  }
}
