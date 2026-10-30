// Типы API «Подтверждение авторасценки». Контракт — по эндпоинтам /api/v1/autoprice-*.

export type AutopriceBasis = 'PD_CONFIRMED' | 'ASSUMED' | 'NOT_IN_PD' | 'RESERVE';
export type AutopriceStatus =
  | 'pending'
  | 'in_progress'
  | 'needs_customer'
  | 'returned'
  | 'approved'
  | 'excluded';
export type AutopriceAction = 'start' | 'approve' | 'return' | 'needs_customer' | 'exclude' | 'reopen';
export type FindingSeverity = 'high' | 'medium' | 'low';
export type FindingResolution = 'fixed' | 'not_duplicate' | 'moved' | 'other';

export interface IAutopriceTender {
  tender_id: string;
  tender_number: string;
  title: string;
  version: number;
}

export interface IAutopriceRun {
  id: string;
  label: string | null;
  source_ref: string | null;
  imported_at: string;
  cancelled_at: string | null;
  user_id?: string;
  positions_total?: number;
  approved_count?: number;
  unapproved_count?: number;
}

export interface IAutopriceQuestion {
  text: string;
  answer?: string | null;
  sent_to_customer?: boolean;
}

export interface IAutopriceFinding {
  kind: string;
  severity: FindingSeverity;
  text: string;
  resolution?: FindingResolution | null;
  resolution_note?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
}

export interface IAutopriceEvent {
  at: string;
  user_id?: string | null;
  user_name?: string | null;
  action: string;
  from?: string | null;
  to?: string | null;
  comment?: string | null;
}

export type VolumeSourceKind = 'ai_model' | 'conditional' | 'customer_boq';

/** Источник объёма позиции: расчёт ИИ по модели, условный объём или ВОР Заказчика. */
export interface IVolumeSource {
  kind: VolumeSourceKind;
  value?: number;
  unit?: string;
  label?: string;
  ref?: string;
  note?: string;
}

/** Элемент списка позиций прогона. */
export interface IReviewRow {
  client_position_id: string;
  position_number: number;
  item_no: string | null;
  work_name: string;
  section: string | null;
  items_count: number;
  zero_price_count: number;
  basis: AutopriceBasis | null;
  pd_refs: string[];
  pd_note: string | null;
  questions: IAutopriceQuestion[];
  findings: IAutopriceFinding[];
  status: AutopriceStatus;
  approval_stale: boolean;
  engineer_comment: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  /** Последнее решение по статусу: approve | return | needs_customer | exclude | reopen. */
  decided_action: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  updated_at: string;
  /** Источник объёма; у старых ответов поля нет — считается null (объём из ВОР). */
  volume_source?: IVolumeSource | null;
}

export interface IReviewDetail extends IReviewRow {
  events: IAutopriceEvent[];
}

export interface IReviewsResponse {
  run: IAutopriceRun;
  reviews: IReviewRow[];
}

export type MachineChangedField =
  | 'unit_rate'
  | 'conversion_coefficient'
  | 'consumption_coefficient'
  | 'work_name_id'
  | 'material_name_id'
  | 'material_type';

export interface IMachineValues {
  name: string | null;
  unit_rate: number | null;
  conversion_coefficient: number | null;
  consumption_coefficient: number | null;
  material_type: string | null;
  quantity: number | null;
}

export interface IPositionItem {
  id: string;
  boq_item_type: string;
  material_type: string | null;
  name: string;
  unit_code: string | null;
  quantity: number | null;
  unit_rate: number | null;
  conversion_coefficient: number | null;
  consumption_coefficient: number | null;
  parent_work_item_id: string | null;
  origin: 'auto' | 'manual';
  machine: IMachineValues | null;
  changed: MachineChangedField[];
}

export interface IDeletedItem {
  boq_item_id: string;
  name: string;
  boq_item_type: string;
  deleted_at: string;
  deleted_by_name: string | null;
}

export interface IPositionInfo {
  id: string;
  position_number: number;
  item_no: string | null;
  work_name: string;
  unit_code: string | null;
  volume: number | null;
  /** Сырой объём ВОР Заказчика (volume выше — с учётом ручной правки). */
  customer_volume?: number | null;
}

export interface IPositionDetail {
  review: IReviewDetail;
  position: IPositionInfo;
  items: IPositionItem[];
  deleted: IDeletedItem[];
}

export interface IReviewPatch {
  engineer_comment?: string | null;
  questions?: IAutopriceQuestion[];
  findings?: IAutopriceFinding[];
}
