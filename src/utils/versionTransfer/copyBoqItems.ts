/**
 * Копирование boq_items с сохранением связей parent_work_item_id
 */

import { supabase } from '../../lib/supabase';
import { getErrorMessage } from '../errors';

const PAGE_SIZE = 1000;

/**
 * Результат копирования boq_items
 */
export interface CopyBoqItemsResult {
  copied: number;
  errors: string[];
}

/**
 * Копировать все boq_items из одной позиции в другую
 *
 * Алгоритм:
 * 1. Загрузить все boq_items старой позиции
 * 2. Первый проход: создать копии без parent_work_item_id, сохранить маппинг старый id → новый id
 * 3. Второй проход: восстановить связи parent_work_item_id используя маппинг
 *
 * @param oldPositionId - ID позиции старой версии
 * @param newPositionId - ID позиции новой версии
 * @param newTenderId - ID нового тендера
 * @returns результат с количеством скопированных элементов
 */
export async function copyBoqItems(
  oldPositionId: string,
  newPositionId: string,
  newTenderId: string
): Promise<CopyBoqItemsResult> {
  const result: CopyBoqItemsResult = {
    copied: 0,
    errors: [],
  };

  try {
    // 1. Загрузить все boq_items старой позиции батчами
    const oldItems: any[] = [];
    let from = 0;

    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('boq_items')
        .select('*')
        .eq('client_position_id', oldPositionId)
        .order('sort_number', { ascending: true })
        .range(from, to);

      if (error) {
        result.errors.push(`Ошибка загрузки boq_items: ${error.message}`);
        return result;
      }

      const batch = data || [];
      oldItems.push(...batch);

      if (batch.length < PAGE_SIZE) {
        break;
      }

      from += PAGE_SIZE;
    }

    if (oldItems.length === 0) {
      return result; // Нет элементов для копирования
    }

    // 2. Первый проход: создать копии без parent_work_item_id
    const itemIdMap = new Map<string, string>(); // старый id → новый id
    const itemsToCreate = oldItems.map(item => ({
      tender_id: newTenderId,
      client_position_id: newPositionId,
      sort_number: item.sort_number,
      boq_item_type: item.boq_item_type,
      material_type: item.material_type,
      material_name_id: item.material_name_id,
      work_name_id: item.work_name_id,
      unit_code: item.unit_code,
      quantity: item.quantity,
      base_quantity: item.base_quantity,
      consumption_coefficient: item.consumption_coefficient,
      conversion_coefficient: item.conversion_coefficient,
      delivery_price_type: item.delivery_price_type,
      delivery_amount: item.delivery_amount,
      currency_type: item.currency_type,
      total_amount: item.total_amount,
      detail_cost_category_id: item.detail_cost_category_id,
      quote_link: item.quote_link,
      commercial_markup: item.commercial_markup,
      total_commercial_material_cost: item.total_commercial_material_cost,
      total_commercial_work_cost: item.total_commercial_work_cost,
      parent_work_item_id: null, // Сбросим, восстановим на втором проходе
      description: item.description,
      unit_rate: item.unit_rate,
    }));

    // 3. Создать новые boq_items батчами и собрать маппинг старый id -> новый id
    let copiedCount = 0;

    for (let start = 0; start < itemsToCreate.length; start += PAGE_SIZE) {
      const end = start + PAGE_SIZE;
      const itemsChunk = itemsToCreate.slice(start, end);
      const oldItemsChunk = oldItems.slice(start, end);

      const { data: newItems, error: insertError } = await supabase
        .from('boq_items')
        .insert(itemsChunk)
        .select('id');

      if (insertError) {
        result.errors.push(`Ошибка вставки boq_items: ${insertError.message}`);
        return result;
      }

      oldItemsChunk.forEach((oldItem, index) => {
        if (newItems && newItems[index]) {
          itemIdMap.set(oldItem.id, newItems[index].id);
        }
      });

      copiedCount += newItems?.length || 0;
    }

    result.copied = copiedCount;

    if (result.copied === 0) {
      return result;
    }

    // 4. Восстановить parent_work_item_id
    const updatePromises: PromiseLike<any>[] = [];

    for (const oldItem of oldItems) {
      if (oldItem.parent_work_item_id) {
        const newItemId = itemIdMap.get(oldItem.id);
        const newParentId = itemIdMap.get(oldItem.parent_work_item_id);

        if (newItemId && newParentId) {
          updatePromises.push(
            supabase
              .from('boq_items')
              .update({ parent_work_item_id: newParentId })
              .eq('id', newItemId)
              .then()
          );
        }
      }
    }

    // Выполнить все обновления параллельно
    const updateResults = await Promise.allSettled(updatePromises);

    // Собрать ошибки обновлений
    updateResults.forEach((res, idx) => {
      if (res.status === 'rejected') {
        result.errors.push(`Ошибка восстановления связи #${idx}: ${res.reason}`);
      }
    });

    // 5. Пересчитать total_material и total_works для новой позиции
    const totalMaterial = oldItems
      .filter((item) =>
        ['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type)
      )
      .reduce((sum, item) => sum + (item.total_amount || 0), 0);

    const totalWorks = oldItems
      .filter((item) => ['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type))
      .reduce((sum, item) => sum + (item.total_amount || 0), 0);

    const { error: updateTotalsError } = await supabase
      .from('client_positions')
      .update({
        total_material: totalMaterial,
        total_works: totalWorks,
      })
      .eq('id', newPositionId);

    if (updateTotalsError) {
      result.errors.push(`Ошибка обновления итогов: ${updateTotalsError.message}`);
    }

  } catch (error) {
    result.errors.push(`Неожиданная ошибка: ${getErrorMessage(error)}`);
  }

  return result;
}

/**
 * Получить количество boq_items у позиции
 *
 * @param positionId - ID позиции
 * @returns количество элементов
 */
export async function getBoqItemsCount(positionId: string): Promise<number> {
  const { count, error } = await supabase
    .from('boq_items')
    .select('id', { count: 'exact', head: true })
    .eq('client_position_id', positionId);

  if (error) {
    console.error('Ошибка подсчета boq_items:', error);
    return 0;
  }

  return count || 0;
}

/**
 * Проверить наличие boq_items у позиции
 *
 * @param positionId - ID позиции
 * @returns true если есть хотя бы один элемент
 */
export async function hasBoqItems(positionId: string): Promise<boolean> {
  const count = await getBoqItemsCount(positionId);
  return count > 0;
}
