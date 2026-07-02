import type { HousingClassType, ConstructionScopeType } from './enums';

// =============================================
// Типы для таблицы tenders
// =============================================

// =============================================
// Справочные таблицы для тендеров
// =============================================

export interface TenderStatus {
  id: string;
  name: string;
  created_at: string;
}

export interface ConstructionScope {
  id: string;
  name: string;
  created_at: string;
}

export interface TenderInsert {
  title: string;
  description?: string;
  client_name: string;
  tender_number: string;
  submission_deadline: string;
  version?: number;
  area_client?: number;
  area_sp?: number;
  usd_rate?: number;
  eur_rate?: number;
  cny_rate?: number;
  upload_folder?: string;
  bsm_link?: string;
  tz_link?: string;
  qa_form_link?: string;
  project_folder_link?: string;
  markup_tactic_id?: string;
  housing_class?: HousingClassType;
  construction_scope?: ConstructionScopeType;
  is_archived?: boolean;
}

export interface Tender extends TenderInsert {
  id: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  cached_grand_total?: number;
  // Базовая стоимость ПЗ = SUM(boq_items.total_amount), считается на лету в Go BFF.
  base_total?: number;
  // Статус согласования «Финансовых показателей», привязан к версии тендера.
  financial_approved?: boolean;
  financial_approved_by?: string | null;
  financial_approved_at?: string | null;
}

// =============================================
// Типы для таблицы tender_registry (реестр тендеров)
// =============================================

export interface ChronologyItem {
  date: string | null;
  text: string;
  type?: 'default' | 'call_follow_up' | null;
}

export interface TenderPackageItem {
  date: string | null;
  text: string;
  link?: string | null;
}

export type DashboardStatus = 'calc' | 'sent' | 'waiting_pd' | 'archive';

export interface TenderRegistryInsert {
  title: string;
  client_name: string;
  tender_number?: string | null;
  object_address?: string | null;
  object_coordinates?: string | null;
  construction_scope_id?: string | null;
  area?: number | null;
  submission_date?: string | null;
  construction_start_date?: string | null;
  commission_date?: string | null;
  site_visit_photo_url?: string | null;
  site_visit_date?: string | null;
  has_tender_package?: string | null; // DEPRECATED — удалить после Фазы 1 baseline
  tender_package_items?: TenderPackageItem[] | null;
  invitation_date?: string | null;
  status_id?: string | null;
  dashboard_status?: DashboardStatus | null;
  chronology?: string | null; // DEPRECATED — удалить после Фазы 1 baseline
  chronology_items?: ChronologyItem[] | null;
  sort_order?: number | null;
  is_archived?: boolean;
  manual_total_cost?: number | null;
}

export interface TenderRegistry extends TenderRegistryInsert {
  id: string;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  sort_order: number;
  is_archived: boolean;
}

export interface TenderRegistryWithRelations extends TenderRegistry {
  status?: TenderStatus | null;
  construction_scope?: ConstructionScope | null;
  total_cost?: number | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface TenderGroupInsert {
  tender_id: string;
  name: string;
  color?: string;
  sort_order?: number;
  quality_level?: number | null;
  quality_comment?: string | null;
  quality_updated_by?: string | null;
  quality_updated_at?: string | null;
}

export interface TenderGroup extends TenderGroupInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface TenderGroupMemberInsert {
  group_id: string;
  user_id: string;
}

export interface TenderGroupMember extends TenderGroupMemberInsert {
  id: string;
  created_at: string;
}

export interface TenderIterationInsert {
  group_id: string;
  user_id: string;
  iteration_number: number;
  user_comment: string;
  user_amount?: number | null;
  submitted_at?: string;
}

export interface TenderIteration extends TenderIterationInsert {
  id: string;
  manager_id: string | null;
  manager_comment: string | null;
  manager_responded_at: string | null;
  approval_status: ApprovalStatus;
  created_at: string;
  updated_at: string;
}

export interface TimelineUserRef {
  id: string;
  full_name: string;
  role_code: string;
}

export interface TenderGroupMemberWithUser extends TenderGroupMember {
  user?: TimelineUserRef | null;
}

export interface TenderIterationWithRelations extends TenderIteration {
  user?: TimelineUserRef | null;
  manager?: TimelineUserRef | null;
}

// =============================================
// Типы для таблицы tender_insurance
// =============================================

export interface TenderInsuranceInsert {
  tender_id: string;
  judicial_pct: number;   // % судебных квартир
  total_pct: number;      // % от общей суммы
  apt_price_m2: number;
  apt_area: number;
  parking_price_m2: number;
  parking_area: number;
  storage_price_m2: number;
  storage_area: number;
}

export interface TenderInsurance extends TenderInsuranceInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

/** Вычисляет итоговую сумму страхования */
export function calcInsuranceTotal(ins: Pick<TenderInsuranceInsert,
  'apt_price_m2' | 'apt_area' | 'parking_price_m2' | 'parking_area' |
  'storage_price_m2' | 'storage_area' | 'judicial_pct' | 'total_pct'>
): number {
  const apt = (ins.apt_price_m2 || 0) * (ins.apt_area || 0);
  const parking = (ins.parking_price_m2 || 0) * (ins.parking_area || 0);
  const storage = (ins.storage_price_m2 || 0) * (ins.storage_area || 0);
  return (apt + parking + storage) * ((ins.judicial_pct || 0) / 100) * ((ins.total_pct || 0) / 100);
}

// =============================================
// TenderNote — заметки пользователей к тендеру
// =============================================

export interface TenderNoteInsert {
  tender_id: string;
  user_id: string;
  note_text: string;
}

export interface TenderNote extends TenderNoteInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

/** С данными автора (для отображения привилегированным ролям) */
export interface TenderNoteFull extends TenderNote {
  user_full_name: string;
}

/** Коды ролей, которые видят все заметки тендера:
 *  Администратор, Разработчик, Руководитель, Ведущий инженер */
export const NOTE_VIEWER_ROLES = [
  'administrator',
  'developer',
  'director',
  'senior_group',
  'veduschiy_inzhener',
] as const;

export const canViewAllNotes = (roleCode: string): boolean =>
  (NOTE_VIEWER_ROLES as readonly string[]).includes(roleCode);
