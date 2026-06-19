import type { UnitType, BoqItemType } from '../../lib/supabase';

export interface TenderOption {
  value: string;
  label: string;
  clientName: string;
}

export interface Tender {
  id: string;
  title: string;
  tender_number: string;
  client_name: string;
  version?: number;
  is_archived?: boolean;
}

export interface BoqItemData {
  id: string;
  boq_item_type: BoqItemType;
  material_type?: 'основн.' | 'вспомогат.';
  name: string;
  total_quantity: number;
  unit_code: UnitType;
  price_per_unit: number;
  total_amount: number;
  usage_count: number; // количество позиций где используется
  quote_link?: string; // Ссылка на КП
  work_name_id?: string; // ID работы для UPDATE
  material_name_id?: string; // ID материала для UPDATE
  detail_cost_category_id?: string;
  expense_label: string; // "КатегорияЗатрат / Детализация / Локализация"
}
