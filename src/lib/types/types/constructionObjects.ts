// ============================================
// Construction Objects Types (Объекты компании на карте)
// ============================================

export type ConstructionObjectStatus = 'archive' | 'current';

export interface IConstructionObject {
  id: string;
  name: string;
  area: number | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  status: ConstructionObjectStatus;
  project_id: string | null;
  project_name: string | null;
  /** Дата ввода, YYYY-MM-DD */
  commissioning_date: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface IConstructionObjectInput {
  name: string;
  area: number | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  status: ConstructionObjectStatus;
  project_id: string | null;
  commissioning_date: string | null;
}
