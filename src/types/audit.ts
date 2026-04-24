import type { BoqItem } from '../lib/supabase/types';

/**
 * Тип операции в audit log
 */
export type AuditOperationType = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Запись истории изменений BOQ item
 */
export interface BoqItemAudit {
  id: string;
  boq_item_id: string;
  operation_type: AuditOperationType;
  changed_at: string;
  changed_by: string | null;
  old_data: BoqItem | null;
  new_data: BoqItem | null;
  changed_fields: string[] | null;

  // Joined data из таблицы users
  user?: {
    id: string;
    full_name: string;
    email: string;
  };

  // Denormalized для отображения в таблице
  item_name?: string;
  cost_categories_map?: Map<string, string>;
  work_names_map?: Map<string, string>;
  material_names_map?: Map<string, string>;
}

/**
 * Описание изменения одного поля
 */
export interface AuditDiffField {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  displayName: string; // Русское название поля для отображения
}

/**
 * Фильтры для поиска в истории изменений
 */
export interface AuditFilters {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  operationType?: AuditOperationType;
}
