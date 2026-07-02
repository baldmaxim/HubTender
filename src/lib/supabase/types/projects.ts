// ============================================
// Projects Types (Текущие объекты)
// ============================================

/**
 * Базовая структура проекта (для вставки)
 */
export interface ProjectInsert {
  name: string;
  client_name: string;
  contract_cost: number;
  contract_date?: string | null;
  area?: number | null;
  construction_end_date?: string | null;
  tender_id?: string | null;
  is_active?: boolean;
  created_by?: string | null;
}

/**
 * Дополнительное соглашение к проекту
 */
export interface ProjectAgreement {
  id: string;
  project_id: string;
  agreement_number: string;
  agreement_date: string;
  amount: number;
  description?: string | null;
  created_at: string;
}

/**
 * Ежемесячное выполнение проекта
 */
export interface ProjectCompletion {
  id: string;
  project_id: string;
  year: number;
  month: number;
  actual_amount: number;
  forecast_amount?: number | null;
  note?: string | null;
  created_at: string;
}

/**
 * Полная структура проекта с вычисляемыми полями
 */
export interface ProjectFull extends ProjectInsert {
  id: string;
  created_at: string;
  updated_at: string;

  // Joined data
  tender?: {
    id: string;
    title: string;
    tender_number: string;
  } | null;

  // Computed fields
  additional_agreements_sum?: number;
  final_contract_cost?: number;
  total_completion?: number;
  completion_percentage?: number;
  tender_name?: string;
  tender_number?: string;
}
