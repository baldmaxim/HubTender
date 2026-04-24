/**
 * Перенос данных позиций (manual_volume, manual_note) из старой версии в новую
 */

import { supabase } from '../../lib/supabase';
import { getErrorMessage } from '../errors';

/**
 * Маппинг для переноса данных
 */
export interface TransferMapping {
  oldPositionId: string;
  newPositionId: string;
  transferData: boolean; // Флаг, переносить ли данные для этой пары
}

/**
 * Результат переноса данных
 */
export interface TransferResult {
  success: number;
  errors: Array<{ oldId: string; newId: string; error: string }>;
}

/**
 * Перенести данные позиций (manual_volume, manual_note)
 *
 * @param mappings - массив маппингов старых и новых позиций
 * @returns результат с количеством успешных переносов и ошибками
 */
export async function transferPositionData(
  mappings: TransferMapping[]
): Promise<TransferResult> {
  const result: TransferResult = {
    success: 0,
    errors: [],
  };

  // Фильтруем только те маппинги, где transferData = true
  const toTransfer = mappings.filter(m => m.transferData);

  if (toTransfer.length === 0) {
    return result;
  }

  try {
    // 1. Массовая загрузка всех старых позиций ОДНИМ запросом
    const oldIds = toTransfer.map(m => m.oldPositionId);

    const { data: oldPositions, error: fetchError } = await supabase
      .from('client_positions')
      .select('id, manual_volume, manual_note')
      .in('id', oldIds);

    if (fetchError) {
      // Если массовая загрузка не удалась, все маппинги считаются ошибочными
      toTransfer.forEach(mapping => {
        result.errors.push({
          oldId: mapping.oldPositionId,
          newId: mapping.newPositionId,
          error: `Ошибка массовой загрузки: ${fetchError.message}`,
        });
      });
      return result;
    }

    // Создать Map для быстрого доступа по ID
    const oldDataMap = new Map<string, { manual_volume: number | null; manual_note: string | null }>();
    oldPositions?.forEach(pos => {
      oldDataMap.set(pos.id, {
        manual_volume: pos.manual_volume,
        manual_note: pos.manual_note,
      });
    });

    // 2. Подготовить параллельные обновления
    const updatePromises = toTransfer.map(async mapping => {
      const oldData = oldDataMap.get(mapping.oldPositionId);

      if (!oldData) {
        return {
          success: false,
          error: {
            oldId: mapping.oldPositionId,
            newId: mapping.newPositionId,
            error: 'Старая позиция не найдена',
          },
        };
      }

      const { error: updateError } = await supabase
        .from('client_positions')
        .update({
          manual_volume: oldData.manual_volume,
          manual_note: oldData.manual_note,
        })
        .eq('id', mapping.newPositionId);

      if (updateError) {
        return {
          success: false,
          error: {
            oldId: mapping.oldPositionId,
            newId: mapping.newPositionId,
            error: `Ошибка обновления: ${updateError.message}`,
          },
        };
      }

      return { success: true };
    });

    // 3. Выполнить все обновления ПАРАЛЛЕЛЬНО
    const updateResults = await Promise.allSettled(updatePromises);

    // 4. Собрать результаты
    updateResults.forEach(promiseResult => {
      if (promiseResult.status === 'fulfilled') {
        if (promiseResult.value.success) {
          result.success++;
        } else if (promiseResult.value.error) {
          result.errors.push(promiseResult.value.error);
        }
      } else {
        // Promise был rejected
        result.errors.push({
          oldId: '',
          newId: '',
          error: `Неожиданная ошибка: ${promiseResult.reason}`,
        });
      }
    });

  } catch (error) {
    toTransfer.forEach(mapping => {
      result.errors.push({
        oldId: mapping.oldPositionId,
        newId: mapping.newPositionId,
        error: getErrorMessage(error) || 'Неизвестная ошибка',
      });
    });
  }

  return result;
}

/**
 * Получить данные позиции для предпросмотра перед переносом
 *
 * @param positionId - ID позиции
 * @returns данные позиции
 */
export async function getPositionDataPreview(positionId: string) {
  const { data, error } = await supabase
    .from('client_positions')
    .select('manual_volume, manual_note, work_name, position_number')
    .eq('id', positionId)
    .single();

  if (error) {
    throw new Error(`Ошибка загрузки данных позиции: ${error.message}`);
  }

  return {
    positionNumber: data.position_number,
    workName: data.work_name,
    manualVolume: data.manual_volume,
    manualNote: data.manual_note,
    hasData: !!(data.manual_volume || data.manual_note),
  };
}

/**
 * Проверить, есть ли данные для переноса у позиции
 *
 * @param positionId - ID позиции
 * @returns true если есть manual_volume или manual_note
 */
export async function hasTransferableData(positionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('client_positions')
    .select('manual_volume, manual_note')
    .eq('id', positionId)
    .single();

  if (error || !data) return false;

  return !!(data.manual_volume || data.manual_note);
}

/**
 * Массовый перенос данных с транзакцией (через RPC если нужно)
 *
 * @param mappings - массив маппингов
 * @returns результат переноса
 */
export async function transferPositionDataBatch(
  mappings: TransferMapping[]
): Promise<TransferResult> {
  // Пока используем последовательный перенос
  // В будущем можно оптимизировать через RPC функцию в Supabase
  return transferPositionData(mappings);
}
