import type {
  UnitType,
  MaterialType,
  BoqItemType,
  CurrencyType,
  DeliveryPriceType,
} from './enums';

// =============================================
// Типы для таблицы boq_items (элементы позиций заказчика)
// =============================================

export interface BoqItemInsert {
  // Связи
  tender_id: string;
  client_position_id: string;

  // Сортировка
  sort_number?: number;

  // Типы элементов
  boq_item_type: BoqItemType;
  material_type?: MaterialType | null;

  // Наименования
  material_name_id?: string | null;
  work_name_id?: string | null;

  // Единица измерения
  unit_code?: string | null;

  // Количественные показатели
  quantity?: number | null;
  base_quantity?: number | null;
  consumption_coefficient?: number | null;
  conversion_coefficient?: number | null;

  // Привязка материала к работе
  parent_work_item_id?: string | null;

  // Доставка
  delivery_price_type?: DeliveryPriceType | null;
  delivery_amount?: number | null;

  // Валюта и суммы
  currency_type?: CurrencyType;
  unit_rate?: number | null;
  total_amount?: number | null;

  // Затрата на строительство
  detail_cost_category_id?: string | null;

  // Примечание
  quote_link?: string | null;
  description?: string | null;

  // Коммерческие показатели
  commercial_markup?: number | null;
  total_commercial_material_cost?: number | null;
  total_commercial_work_cost?: number | null;
}

export interface BoqItem extends BoqItemInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// Расширенный тип с JOIN данными
export interface BoqItemFull extends BoqItem {
  // Данные из material_names
  material_name?: string;
  material_unit?: UnitType;

  // Данные из work_names
  work_name?: string;
  work_unit?: UnitType;

  // Данные из detail_cost_categories
  detail_cost_category_name?: string;
  detail_cost_category_full?: string; // Format: "Category / Detail / Location"

  // Данные из units
  unit_name?: string;

  // Данные родительской работы (для привязанных материалов)
  parent_work_name?: string;
  parent_work_unit?: UnitType;
  parent_work_quantity?: number;
}

// =============================================
// Типы для таблицы notifications (уведомления)
// =============================================

export type NotificationType = 'success' | 'info' | 'warning' | 'pending';

export interface NotificationInsert {
  type: NotificationType;
  title: string;
  message: string;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  is_read?: boolean;
}

export interface Notification extends NotificationInsert {
  id: string;
  created_at: string;
}

// =============================================
// Типы для таблицы client_positions (позиции заказчика)
// =============================================

// Зачёркивание, извлечённое из Excel при импорте (только для отображения).
// Текстовые поля — массив ранов (частичное зачёркивание), volume — булев флаг
// (число зачёркнуто целиком либо нет). Хранится в client_positions.rich_runs (jsonb),
// заполняется только при наличии зачёркивания.
export interface StrikeRun {
  t: string; // текст фрагмента
  s: boolean; // зачёркнут ли фрагмент
}

export interface RichRuns {
  work_name?: StrikeRun[];
  item_no?: StrikeRun[];
  client_note?: StrikeRun[];
  volume_struck?: boolean;
}

export interface ClientPositionInsert {
  tender_id: string;
  position_number: number;
  unit_code?: string | null;
  volume?: number | null;
  client_note?: string | null;
  item_no?: string | null;
  work_name: string;
  manual_volume?: number | null;
  manual_note?: string | null;
  hierarchy_level?: number;
  is_additional?: boolean;
  parent_position_id?: string | null;
  total_material?: number;
  total_works?: number;
  material_cost_per_unit?: number;
  work_cost_per_unit?: number;
  total_commercial_material?: number;
  total_commercial_work?: number;
  total_commercial_material_per_unit?: number;
  total_commercial_work_per_unit?: number;
  rich_runs?: RichRuns | null;
}

export interface ClientPosition extends ClientPositionInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы import_sessions (сессии импорта BOQ из Excel)
// =============================================

export interface ImportSession {
  id: string;
  user_id: string | null;
  tender_id: string;
  file_name: string | null;
  items_count: number;
  positions_snapshot: Array<{
    id: string;
    manual_volume: number | null;
    manual_note: string | null;
  }> | null;
  imported_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

// =============================================
// Типы для таблицы user_position_filters (персональные фильтры позиций)
// =============================================

export interface UserPositionFilter {
  id: string;
  user_id: string;
  tender_id: string;
  position_id: string;
  created_at: string;
}
