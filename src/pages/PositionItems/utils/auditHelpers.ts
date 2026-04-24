import type { BoqItemAudit, AuditDiffField, AuditOperationType } from '../../../types/audit';
import dayjs from 'dayjs';

/**
 * Получает список измененных полей с их старыми и новыми значениями
 *
 * @param record - Запись из audit log
 * @returns Массив описаний изменений полей
 */
export function getFieldDiffs(record: BoqItemAudit): AuditDiffField[] {
  // Для INSERT и DELETE не показываем diff
  if (record.operation_type === 'INSERT' || record.operation_type === 'DELETE') {
    return [];
  }

  const { old_data, new_data, changed_fields } = record;

  if (!old_data || !new_data || !changed_fields || changed_fields.length === 0) {
    return [];
  }

  return changed_fields
    .filter((field) => !['updated_at', 'created_at'].includes(field))
    .map((field) => ({
      field,
      oldValue: (old_data as unknown as Record<string, unknown>)[field],
      newValue: (new_data as unknown as Record<string, unknown>)[field],
      displayName: getFieldDisplayName(field),
    }));
}

/**
 * Маппинг полей на русские названия
 *
 * @param field - Название поля в английской нотации
 * @returns Русское название для отображения
 */
export function getFieldDisplayName(field: string): string {
  const fieldNames: Record<string, string> = {
    tender_id: 'Тендер',
    client_position_id: 'Позиция заказчика',
    sort_number: 'Порядок сортировки',
    boq_item_type: 'Вид строки',
    material_type: 'Тип материала',
    material_name_id: 'Наименование материала',
    work_name_id: 'Наименование работы',
    unit_code: 'Ед. изм.',
    quantity: 'Количество',
    unit_rate: 'Цена за единицу',
    currency_type: 'Валюта',
    total_amount: 'Сумма',
    detail_cost_category_id: 'Затраты',
    quote_link: 'Ссылка на КП',
    description: 'Примечание',
    parent_work_item_id: 'Родительская работа',
    conversion_coefficient: 'Коэффициент расхода',
    initial_price: 'Базовая цена',
    calculated_price: 'Рассчитанная цена',
    markup_percentage: 'Процент наценки',
    material_growth_coefficient: 'Коэффициент роста материалов',
    delivery_price_type: 'Тип цены доставки',
  };

  return fieldNames[field] || field;
}

/**
 * Форматирует значение поля для отображения
 *
 * @param field - Название поля
 * @param value - Значение поля
 * @param costCategoriesMap - Map для резолва detail_cost_category_id
 * @param workNamesMap - Map для резолва work_name_id
 * @param materialNamesMap - Map для резолва material_name_id
 * @returns Отформатированная строка
 */
export function formatFieldValue(
  field: string,
  value: unknown,
  costCategoriesMap?: Map<string, string>,
  workNamesMap?: Map<string, string>,
  materialNamesMap?: Map<string, string>
): string {
  if (value === null || value === undefined) {
    return '-';
  }

  // Затраты на строительство - показываем название вместо UUID
  if (field === 'detail_cost_category_id' && typeof value === 'string') {
    if (costCategoriesMap && costCategoriesMap.has(value)) {
      return costCategoriesMap.get(value)!;
    }
    return value.substring(0, 8) + '...';
  }

  // Наименование работы - показываем название вместо UUID
  if (field === 'work_name_id' && typeof value === 'string') {
    if (workNamesMap && workNamesMap.has(value)) {
      return workNamesMap.get(value)!;
    }
    return value.substring(0, 8) + '...';
  }

  // Наименование материала - показываем название вместо UUID
  if (field === 'material_name_id' && typeof value === 'string') {
    if (materialNamesMap && materialNamesMap.has(value)) {
      return materialNamesMap.get(value)!;
    }
    return value.substring(0, 8) + '...';
  }

  // Числовые поля с точностью
  if (
    [
      'quantity',
      'unit_rate',
      'total_amount',
      'conversion_coefficient',
      'initial_price',
      'calculated_price',
      'markup_percentage',
      'material_growth_coefficient',
    ].includes(field)
  ) {
    const num = Number(value);
    if (isNaN(num)) return String(value);

    // Для процентов и коэффициентов - до 2 знаков
    if (['markup_percentage', 'material_growth_coefficient', 'conversion_coefficient'].includes(field)) {
      return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Для количества - до 6 знаков (по схеме БД numeric(18,6))
    if (field === 'quantity') {
      return num.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
    }

    // Для цен - до 2 знаков
    return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Даты
  if (field === 'created_at' || field === 'updated_at' || field === 'changed_at') {
    return dayjs(String(value)).format('DD.MM.YYYY HH:mm');
  }

  // Enum значения
  if (field === 'boq_item_type') {
    return String(value); // мат, суб-мат, раб и т.д.
  }

  if (field === 'material_type') {
    return String(value); // основн., вспомогат.
  }

  if (field === 'currency_type') {
    return String(value); // RUB, USD, EUR, CNY
  }

  // UUID (сокращенно)
  if (
    field.endsWith('_id') &&
    typeof value === 'string' &&
    value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  ) {
    return value.substring(0, 8) + '...';
  }

  // Строки
  return String(value);
}

/**
 * Форматирует дату и время в читаемый формат
 *
 * @param iso - ISO строка даты
 * @returns Отформатированная дата
 */
export function formatDateTime(iso: string): string {
  return dayjs(iso).format('DD.MM.YYYY HH:mm:ss');
}

/**
 * Возвращает цвет для тега типа операции
 *
 * @param operationType - Тип операции
 * @returns Название цвета Ant Design
 */
export function getOperationColor(operationType: AuditOperationType): string {
  const colorMap: Record<AuditOperationType, string> = {
    INSERT: 'green',
    UPDATE: 'blue',
    DELETE: 'red',
  };

  return colorMap[operationType] || 'default';
}

/**
 * Возвращает текст операции на русском
 *
 * @param operationType - Тип операции
 * @returns Русский текст
 */
export function getOperationText(operationType: AuditOperationType): string {
  const textMap: Record<AuditOperationType, string> = {
    INSERT: 'Добавление',
    UPDATE: 'Изменение',
    DELETE: 'Удаление',
  };

  return textMap[operationType] || operationType;
}

/**
 * Получает название пользователя из записи audit
 *
 * @param record - Запись audit
 * @returns Имя пользователя или "Системная операция"
 */
export function getUserDisplayName(record: BoqItemAudit): string {
  if (record.user?.full_name) {
    return record.user.full_name;
  }

  if (record.user?.email) {
    return record.user.email;
  }

  if (record.changed_by) {
    return `Пользователь ${record.changed_by.substring(0, 8)}...`;
  }

  return 'Системная операция';
}

/**
 * Проверяет, можно ли выполнить rollback для данной записи
 *
 * @param record - Запись audit
 * @returns true если rollback возможен
 */
export function canRollback(record: BoqItemAudit): boolean {
  // Rollback возможен только для UPDATE и INSERT (восстановление к old_data)
  // Для DELETE не имеет смысла - элемент уже удален
  return record.operation_type !== 'DELETE' && record.old_data !== null;
}

/**
 * Извлекает ID наименования (работы или материала) из audit записи
 *
 * @param record - Запись audit
 * @returns {work_name_id, material_name_id}
 */
export function getItemNameId(record: BoqItemAudit): { work_name_id?: string; material_name_id?: string } {
  // Приоритет: new_data (для INSERT/UPDATE), затем old_data (для DELETE)
  const data = record.new_data || record.old_data;

  if (!data) {
    return {};
  }

  return {
    work_name_id: data.work_name_id || undefined,
    material_name_id: data.material_name_id || undefined,
  };
}
