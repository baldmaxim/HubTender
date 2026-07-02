// Чистые билдеры payload'а для POST /api/v1/imports/boq и анализ расхождений
// после атомарного импорта. Вынесено из useMassBoqImport без изменений логики.
// Импортируем соседей напрямую (не через '../utils' — барель реэкспортирует
// и этот файл, self-import создал бы цикл).
import { ParsedBoqItem, PositionUpdateData, isWork, isMaterial } from './massBoqImportUtils';
import { calculateTotalAmount } from './massBoqImportValidation';

export const buildPositionUpdatesPayload = (
  positionUpdates: Map<string, PositionUpdateData>,
): Record<string, unknown>[] => {
  return Array.from(positionUpdates.values())
    .filter(posData =>
      posData.positionId &&
      (posData.manualVolume !== undefined || posData.manualNote !== undefined)
    )
    .map((posData) => {
      const payload: Record<string, unknown> = {
        position_id: posData.positionId,
        position_number: posData.positionNumber,
      };

      if (posData.manualVolume !== undefined) {
        payload.manual_volume = posData.manualVolume;
      }
      if (posData.manualNote !== undefined) {
        payload.manual_note = posData.manualNote;
      }

      return payload;
    });
};

export const buildBoqItemsPayload = (
  data: ParsedBoqItem[],
  rates: { usd: number; eur: number; cny: number },
): Record<string, unknown>[] => {
  return data
    .filter(item => item.matchedPositionId)
    .map((item) => {
      const payload: Record<string, unknown> = {
        row_index: item.rowIndex,
        client_position_id: item.matchedPositionId,
        boq_item_type: item.boq_item_type,
        unit_code: item.unit_code,
        quantity: item.quantity,
        total_amount: calculateTotalAmount(item, rates),
      };

      if (item.base_quantity !== undefined) {
        payload.base_quantity = item.base_quantity;
      }
      if (item.consumption_coefficient !== undefined) {
        payload.consumption_coefficient = item.consumption_coefficient;
      }
      if (item.conversion_coefficient !== undefined) {
        payload.conversion_coefficient = item.conversion_coefficient;
      }
      if (item.currency_type) {
        payload.currency_type = item.currency_type;
      }
      if (item.delivery_price_type) {
        payload.delivery_price_type = item.delivery_price_type;
      }
      if (item.delivery_amount !== undefined) {
        payload.delivery_amount = item.delivery_amount;
      }
      if (item.unit_rate !== undefined) {
        payload.unit_rate = item.unit_rate;
      }
      if (item.detail_cost_category_id) {
        payload.detail_cost_category_id = item.detail_cost_category_id;
      }
      if (item.quote_link) {
        payload.quote_link = item.quote_link;
      }
      if (item.description) {
        payload.description = item.description;
      }

      if (isWork(item.boq_item_type)) {
        payload.work_name_id = item.work_name_id;
        if (item.tempId) {
          payload.temp_id = item.tempId;
        }
      }

      if (isMaterial(item.boq_item_type)) {
        payload.material_type = item.material_type;
        payload.material_name_id = item.material_name_id;
        if (item.parent_work_item_id) {
          payload.parent_work_temp_id = item.parent_work_item_id;
        }
      }

      return payload;
    });
};

export interface ImportMismatchAnalysis {
  expectedItems: number;
  expectedPositions: number;
  droppedItems: number;
  mismatch: boolean;
  droppedRows: number[];
  mismatchMsg: string;
}

/**
 * Сверка количеств после импорта: бэк атомарен и вставляет ровно то, что мы
 * отправили, поэтому любое расхождение = тихая потеря данных. droppedItems —
 * элементы, выброшенные фильтром matchedPositionId (не сопоставлены с позицией).
 * Побочные эффекты (message.error / setImportError) остаются в хуке.
 */
export const analyzeImportMismatch = (
  insertedItemsCount: number,
  updatedPositionsCount: number,
  itemsPayloadLength: number,
  positionUpdatesPayloadLength: number,
  data: ParsedBoqItem[],
): ImportMismatchAnalysis => {
  const expectedItems = itemsPayloadLength;
  const expectedPositions = positionUpdatesPayloadLength;
  const droppedItems = data.length - expectedItems;

  const mismatch =
    insertedItemsCount !== expectedItems ||
    updatedPositionsCount !== expectedPositions ||
    droppedItems > 0;

  const droppedRows = mismatch
    ? data.filter(item => !item.matchedPositionId).map(item => item.rowIndex)
    : [];

  const mismatchMsg =
    `Импортировано ${insertedItemsCount} из ${expectedItems} элементов, ` +
    `обновлено ${updatedPositionsCount} из ${expectedPositions} позиций` +
    (droppedItems > 0 ? `; пропущено строк без позиции: ${droppedItems}` : '') +
    ' — часть данных не загружена. Проверьте позиции.';

  return { expectedItems, expectedPositions, droppedItems, mismatch, droppedRows, mismatchMsg };
};
