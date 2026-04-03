import type { BoqItemFull, ExportRow, BoqItemType, ClientPosition } from './types';

/**
 * Проверяет является ли тип элемента работой
 */
export const isWorkType = (type: BoqItemType): boolean => {
  return ['раб', 'суб-раб', 'раб-комп.'].includes(type);
};

/**
 * Проверяет является ли тип элемента материалом
 */
export const isMaterialType = (type: BoqItemType): boolean => {
  return ['мат', 'суб-мат', 'мат-комп.'].includes(type);
};

/**
 * Форматирует категорию затрат
 */
export function formatCostCategory(item: BoqItemFull): string {
  if (!item.detail_cost_categories) return '';

  const category = item.detail_cost_categories.cost_categories?.name || '';
  const detail = item.detail_cost_categories.name || '';
  const location = item.detail_cost_categories.location || '';

  return `${category} / ${detail} / ${location}`;
}

/**
 * Форматирует число БЕЗ разделителя тысяч, с запятой как десятичным разделителем
 */
export function formatNumber(value: number | null, decimalPlaces: number = 2): string | number {
  if (value === null || value === undefined) return '';

  // Форматировать с нужным количеством знаков после запятой, заменить точку на запятую
  return value.toFixed(decimalPlaces).replace('.', ',');
}

/**
 * Создает строку экспорта из позиции заказчика
 */
export function createPositionRow(
  position: ClientPosition,
  isLeaf: boolean,
  actualTotalAmount: number | null = null
): ExportRow {
  // Для листовых позиций: использовать только actualTotalAmount (null если нет BOQ items)
  // Для нелистовых позиций: использовать агрегированные поля position
  const totalAmount = isLeaf
    ? actualTotalAmount
    : (position.total_material || 0) + (position.total_works || 0);

  return {
    itemNo: position.item_no || position.position_number,
    positionNumber: position.position_number,
    costCategory: '',
    elementType: '',
    materialType: '',
    name: position.work_name,
    unit: position.unit_code || '',
    clientVolume: position.volume || null,
    conversionCoeff: null,
    consumptionCoeff: null,
    gpVolume: position.manual_volume || null,
    currency: '',
    deliveryType: '',
    deliveryCost: null,
    unitPrice: null,
    totalAmount: totalAmount,
    materialLinkedToWork: '',
    quoteLink: '',
    clientNote: position.client_note || '',
    gpNote: position.manual_note || '',
    isPosition: true,
    isLeaf: isLeaf,
    boqItemType: null,
  };
}

/**
 * Создает строку экспорта из BOQ item
 */
export function createBoqItemRow(item: BoqItemFull, position: ClientPosition): ExportRow {
  const name = isWorkType(item.boq_item_type)
    ? item.work_names?.name || ''
    : item.material_names?.name || '';

  const unit = isWorkType(item.boq_item_type)
    ? item.work_names?.unit || ''
    : item.material_names?.unit || '';

  // Рассчитать стоимость доставки в зависимости от типа
  let deliveryCost: number | null = null;
  if (item.delivery_price_type === 'не в цене' && item.unit_rate) {
    // 3% от цены материала за единицу
    deliveryCost = item.unit_rate * 0.03;
  } else if (item.delivery_price_type === 'суммой' && item.delivery_amount) {
    deliveryCost = item.delivery_amount;
  }
  // Если тип "в цене" или не указан - оставляем null

  return {
    itemNo: '',
    positionNumber: position.position_number,
    costCategory: formatCostCategory(item),
    elementType: item.boq_item_type || '',
    materialType: item.material_type || '',
    name: name,
    unit: item.unit_code || unit || '',
    clientVolume: null,
    conversionCoeff: item.conversion_coefficient || null,
    consumptionCoeff: item.consumption_coefficient || null,
    gpVolume: item.quantity || null,
    currency: item.currency_type || '',
    deliveryType: item.delivery_price_type || '',
    deliveryCost: deliveryCost,
    unitPrice: item.unit_rate || null,
    totalAmount: item.total_amount || null,
    materialLinkedToWork: isMaterialType(item.boq_item_type)
      ? (item.parent_work_item_id ? 'да' : 'нет')
      : '',
    quoteLink: item.quote_link || '',
    clientNote: '',
    gpNote: item.description || '',
    isPosition: false,
    isLeaf: false,
    boqItemType: item.boq_item_type,
  };
}
