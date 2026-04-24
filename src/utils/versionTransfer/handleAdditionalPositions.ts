/**
 * Обработка дополнительных работ при переносе версий
 *
 * Ключевые задачи:
 * 1. Если родитель сопоставлен - использовать новый parent_position_id
 * 2. Если родитель удален - найти соседнюю строку того же раздела (item_no)
 * 3. Создать ДОП работы с правильным position_number (decimal суффикс)
 */

import { supabase } from '../../lib/supabase';
import { getErrorMessage } from '../errors';
import type { ClientPosition } from '../../lib/supabase';
import { copyBoqItems } from './copyBoqItems';

/**
 * Результат переноса одной дополнительной работы
 */
export interface AdditionalWorkTransfer {
  additionalPosition: ClientPosition;
  originalParentId: string;
  newParentId: string | null;
  alternativeParentId?: string;
  reason: 'parent_matched' | 'parent_deleted_found_alternative' | 'no_parent_found';
  success: boolean;
  error?: string;
}

/**
 * Найти альтернативного родителя (соседнюю строку того же раздела)
 *
 * Алгоритм:
 * 1. Поиск вверх: предыдущая строка с тем же item_no
 * 2. Если не найдено - поиск вниз: следующая строка с тем же item_no
 *
 * @param deletedParent - удаленная родительская позиция
 * @param newPositions - позиции новой версии
 * @returns альтернативный родитель или null
 */
export async function findAlternativeParent(
  deletedParent: ClientPosition,
  newPositions: ClientPosition[]
): Promise<ClientPosition | null> {
  const targetItemNo = deletedParent.item_no;
  const targetPosNum = deletedParent.position_number;

  if (!targetItemNo) {
    return null; // Нет раздела - невозможно найти альтернативу
  }

  // Фильтруем позиции того же раздела
  const sameSection = newPositions.filter(p => p.item_no === targetItemNo);

  if (sameSection.length === 0) {
    return null; // Весь раздел удален
  }

  // Поиск вверх (предыдущая строка)
  const prevMatches = sameSection
    .filter(p => p.position_number < targetPosNum)
    .sort((a, b) => b.position_number - a.position_number);

  if (prevMatches.length > 0) {
    return prevMatches[0];
  }

  // Поиск вниз (следующая строка)
  const nextMatches = sameSection
    .filter(p => p.position_number > targetPosNum)
    .sort((a, b) => a.position_number - b.position_number);

  if (nextMatches.length > 0) {
    return nextMatches[0];
  }

  return null;
}

/**
 * Вычислить следующий position_number для дополнительной работы
 *
 * Формат: parent_position_number + 0.1, 0.2, 0.3 и т.д.
 * Например: если родитель 5.0, то ДОП работы будут 5.1, 5.2, 5.3
 *
 * @param parentId - ID родительской позиции
 * @returns следующий номер для дополнительной работы
 */
async function calculateNextAdditionalNumber(parentId: string): Promise<number> {
  // Получить родительскую позицию
  const { data: parent } = await supabase
    .from('client_positions')
    .select('position_number')
    .eq('id', parentId)
    .single();

  if (!parent) {
    throw new Error('Родительская позиция не найдена');
  }

  // Получить все существующие дополнительные работы этого родителя
  const { data: existingAdditional } = await supabase
    .from('client_positions')
    .select('position_number')
    .eq('parent_position_id', parentId)
    .eq('is_additional', true)
    .order('position_number', { ascending: false })
    .limit(1);

  if (existingAdditional && existingAdditional.length > 0) {
    // Есть уже дополнительные работы - увеличиваем суффикс
    const lastNumber = existingAdditional[0].position_number;
    const decimalPart = lastNumber - Math.floor(lastNumber);
    const nextSuffix = Math.round((decimalPart + 0.1) * 10) / 10;
    return Math.floor(lastNumber) + nextSuffix;
  } else {
    // Первая дополнительная работа - добавляем .1
    return parent.position_number + 0.1;
  }
}

/**
 * Перенести дополнительные работы
 *
 * @param additionalPositions - дополнительные работы старой версии
 * @param matchMap - маппинг старых позиций на новые (oldId → newId)
 * @param newPositions - все позиции новой версии
 * @param newTenderId - ID нового тендера
 * @returns результаты переноса каждой ДОП работы
 */
export async function transferAdditionalPositions(
  additionalPositions: ClientPosition[],
  matchMap: Map<string, string>,
  newPositions: ClientPosition[],
  newTenderId: string
): Promise<AdditionalWorkTransfer[]> {
  const results: AdditionalWorkTransfer[] = [];

  if (additionalPositions.length === 0) {
    return results;
  }

  // ОПТИМИЗАЦИЯ: Предзагрузить всех старых родителей ОДНИМ запросом
  const parentIds = additionalPositions
    .map(w => w.parent_position_id)
    .filter((id): id is string => id !== null && id !== undefined);

  const uniqueParentIds = [...new Set(parentIds)];

  const { data: oldParents } = await supabase
    .from('client_positions')
    .select('*')
    .in('id', uniqueParentIds);

  const oldParentMap = new Map<string, ClientPosition>();
  oldParents?.forEach(parent => {
    oldParentMap.set(parent.id, parent);
  });

  for (const additionalWork of additionalPositions) {
    const originalParentId = additionalWork.parent_position_id;

    if (!originalParentId) {
      // Нет родителя - пропускаем
      results.push({
        additionalPosition: additionalWork,
        originalParentId: '',
        newParentId: null,
        reason: 'no_parent_found',
        success: false,
        error: 'Отсутствует parent_position_id',
      });
      continue;
    }

    try {
      // Проверяем, сопоставлен ли родитель
      const newParentId = matchMap.get(originalParentId);

      let targetParentId: string | null = null;
      let reason: AdditionalWorkTransfer['reason'];

      if (newParentId) {
        // Родитель сопоставлен - используем его
        targetParentId = newParentId;
        reason = 'parent_matched';
      } else {
        // Родитель удален - ищем альтернативу (используем предзагруженные данные)
        const oldParent = oldParentMap.get(originalParentId);

        if (oldParent) {
          const alternative = await findAlternativeParent(oldParent, newPositions);

          if (alternative) {
            targetParentId = alternative.id;
            reason = 'parent_deleted_found_alternative';
          } else {
            reason = 'no_parent_found';
          }
        } else {
          reason = 'no_parent_found';
        }
      }

      if (!targetParentId) {
        // Не удалось найти родителя
        results.push({
          additionalPosition: additionalWork,
          originalParentId,
          newParentId: null,
          reason,
          success: false,
          error: 'Не найден подходящий родитель',
        });
        continue;
      }

      // Вычислить position_number для новой ДОП работы
      const newPositionNumber = await calculateNextAdditionalNumber(targetParentId);

      // Создать новую дополнительную работу
      const { data: newAdditionalWork, error: createError } = await supabase
        .from('client_positions')
        .insert({
          tender_id: newTenderId,
          position_number: newPositionNumber,
          work_name: additionalWork.work_name,
          unit_code: additionalWork.unit_code,
          volume: additionalWork.volume,
          client_note: additionalWork.client_note,
          manual_volume: additionalWork.manual_volume,
          manual_note: additionalWork.manual_note,
          hierarchy_level: (additionalWork.hierarchy_level || 0),
          is_additional: true,
          parent_position_id: targetParentId,
          item_no: null,
        })
        .select()
        .single();

      if (createError) {
        results.push({
          additionalPosition: additionalWork,
          originalParentId,
          newParentId: targetParentId,
          reason,
          success: false,
          error: `Ошибка создания: ${createError.message}`,
        });
        continue;
      }

      // Скопировать boq_items
      await copyBoqItems(additionalWork.id, newAdditionalWork.id, newTenderId);

      results.push({
        additionalPosition: additionalWork,
        originalParentId,
        newParentId: targetParentId,
        reason,
        success: true,
      });

    } catch (error) {
      results.push({
        additionalPosition: additionalWork,
        originalParentId,
        newParentId: null,
        reason: 'no_parent_found',
        success: false,
        error: getErrorMessage(error) || 'Неизвестная ошибка',
      });
    }
  }

  return results;
}
