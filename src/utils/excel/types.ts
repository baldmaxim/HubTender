import type {
  ClientPosition,
  BoqItemType,
  MaterialType,
  CurrencyType,
  DeliveryPriceType
} from '../../lib/supabase';

/**
 * Интерфейс для строки Excel экспорта
 */
export interface ExportRow {
  // Позиционирование
  itemNo: string | number;          // Номер позиции
  positionNumber: number;            // № п/п

  // Категория
  costCategory: string;              // Затрата на строительство

  // Типы
  elementType: string;               // Тип элемента
  materialType: string;              // Тип материала

  // Наименование
  name: string;                      // Наименование

  // Единица измерения и количество
  unit: string;                      // Ед. изм.
  clientVolume: number | null;       // Количество заказчика
  conversionCoeff: number | null;    // Коэфф. перевода
  consumptionCoeff: number | null;   // Коэфф. расхода
  gpVolume: number | null;           // Количество ГП

  // Финансы
  currency: string;                  // Валюта
  deliveryType: string;              // Тип доставки
  deliveryCost: number | null;       // Стоимость доставки
  unitPrice: number | null;          // Цена за единицу
  totalAmount: number | null;        // Итоговая сумма

  // Привязка
  materialLinkedToWork: string;      // Привязка материала к работе ('да'/'нет'/'')

  // Примечания
  quoteLink: string;                 // Ссылка на КП
  clientNote: string;                // Примечание заказчика
  gpNote: string;                    // Примечание ГП

  // Мета-информация для стилизации
  isPosition: boolean;               // Это позиция заказчика
  isLeaf: boolean;                   // Конечная позиция
  boqItemType: BoqItemType | null;   // Тип BOQ элемента
}

/**
 * Интерфейс для BOQ Item с JOIN данными
 */
export interface BoqItemFull {
  id: string;
  tender_id: string;
  client_position_id: string;
  sort_number?: number;
  boq_item_type: BoqItemType;
  material_type?: MaterialType | null;
  unit_code?: string | null;
  quantity?: number | null;
  base_quantity?: number | null;
  consumption_coefficient?: number | null;
  conversion_coefficient?: number | null;
  parent_work_item_id?: string | null;
  delivery_price_type?: DeliveryPriceType | null;
  delivery_amount?: number | null;
  currency_type?: CurrencyType;
  unit_rate?: number | null;
  total_amount?: number | null;
  detail_cost_category_id?: string | null;
  quote_link?: string | null;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
  work_names?: { name: string; unit: string } | null;
  material_names?: { name: string; unit: string } | null;
  detail_cost_categories?: {
    name: string;
    location: string;
    cost_categories: { name: string } | null;
  } | null;
}

export type { ClientPosition, BoqItemType };
