// Типы API «Расценивание по реальному аналогу». Контракт — /api/v1/positions/{id}/analogs и др.

export type AnalogTargetState = 'empty' | 'draft_only' | 'has_foreign_rows' | 'locked';
export type AnalogUnitCompatibility = 'exact' | 'unknown' | 'conflict';
export type AnalogScaleMode = 'volume_ratio' | 'factor' | 'none';
export type AnalogApplicationStatus = 'applied' | 'superseded' | 'reverted';

export interface IAnalogRow {
  /** null в предпросмотре (строка ещё не создана). */
  id: string | null;
  /** Порядковый номер в составе (0..). */
  index: number;
  /** Индекс родительской работы в этом же списке. */
  parent_index: number | null;
  /** 'раб' | 'суб-раб' | 'раб-комп.' | 'мат' | 'суб-мат' | 'мат-комп.' */
  boq_item_type: string;
  /** 'основн.' | 'вспомогат.' */
  material_type: string | null;
  name: string;
  unit_code: string | null;
  quantity: number | null;
  conversion_coefficient: number | null;
  consumption_coefficient: number | null;
  unit_rate: number | null;
  currency_type: string | null;
  delivery_price_type: string | null;
  delivery_amount: number | null;
  /** Источник: историческая; предпросмотр: по курсам цели (серверный расчёт). */
  total_amount: number | null;
  quote_price_date: string | null;
  quote_valid_until: string | null;
  quote_link: string | null;
  source_item_id: string | null;
  /** Только для target.items: строка чернового прогона аналогов. */
  is_draft: boolean;
}

export interface IAnalogTarget {
  position_id: string;
  tender_id: string;
  tender_number: string | null;
  tender_version: number | null;
  position_number: number | null;
  item_no: string | null;
  work_name: string;
  unit_code: string | null;
  /** Действующий: manual_volume ?? volume. */
  volume: number | null;
  client_note: string | null;
  manual_note: string | null;
  state: AnalogTargetState;
  review_status: string | null;
  /** Черновой прогон аналогов, если уже есть. */
  run_id: string | null;
  draft_rows_count: number;
  foreign_rows_count: number;
  items: IAnalogRow[];
}

export interface IAnalogHit {
  position_id: string;
  tender_id: string;
  tender_number: string | null;
  tender_version: number | null;
  tender_title: string | null;
  object_name: string | null;
  client_name: string | null;
  financial_approved: boolean | null;
  tender_created_at: string | null;
  item_no: string | null;
  work_name: string;
  unit_code: string | null;
  volume: number | null;
  items_count: number;
  score: number;
  unit_compatibility: AnalogUnitCompatibility;
  significant_token_conflict: boolean;
}

export interface IAnalogSearchResponse {
  target: IAnalogTarget;
  query: string;
  hits: IAnalogHit[];
  has_more: boolean;
}

export interface IAnalogSourceTender {
  id: string;
  tender_number: string | null;
  version: number | null;
  title: string | null;
  object_name: string | null;
  client_name: string | null;
  created_at: string | null;
  financial_approved: boolean | null;
}

export interface IAnalogSource {
  position: {
    id: string;
    position_number: number | null;
    item_no: string | null;
    work_name: string;
    position_name: string | null;
    unit_code: string | null;
    volume: number | null;
    client_note: string | null;
    manual_note: string | null;
  };
  tender: IAnalogSourceTender;
  items: IAnalogRow[];
}

export interface IAnalogScale {
  mode: AnalogScaleMode;
  factor?: number;
}

export interface IAnalogRequest {
  source_position_id: string;
  scale: IAnalogScale;
  copy_prices: boolean;
}

export interface IAnalogApplyRequest extends IAnalogRequest {
  preview_token: string;
  idempotency_key: string;
}

export interface IAnalogWarning {
  code: string;
  message: string;
  [k: string]: unknown;
}

export interface IAnalogPreview {
  target: IAnalogTarget;
  source: IAnalogSourceTender & {
    position_id: string;
    work_name: string;
    unit_code: string | null;
    volume: number | null;
  };
  scale: {
    mode: string;
    factor: number;
    source_volume: number | null;
    target_volume: number | null;
    units_match: boolean;
  };
  items: IAnalogRow[];
  totals: {
    works_count: number;
    materials_count: number;
    parent_links_restored: number;
    total_material: number;
    total_works: number;
  };
  warnings: IAnalogWarning[];
  can_apply: boolean;
  blocked_reason: string | null;
  preview_token: string;
}

export interface IAnalogApplication {
  id: string;
  status: AnalogApplicationStatus;
  tender_id: string;
  client_position_id: string;
  run_id: string;
  source_position_id: string;
  source_tender_id: string;
  source_tender_number: string | null;
  source_tender_version: number | null;
  source_work_name: string;
  scale_mode: string;
  scale_factor: number;
  source_volume: number | null;
  target_volume: number | null;
  copy_prices: boolean;
  items_created: number;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  reverted_by_name: string | null;
  reverted_at: string | null;
}

export interface IAnalogApplyResult {
  application: IAnalogApplication;
  run_id: string;
  replayed: boolean;
}

export interface IAnalogNextPosition {
  position_id: string;
  position_number: number | null;
  item_no: string | null;
  work_name: string;
}
