// ============================================
// Construction Objects Types (Объекты компании на карте)
// ============================================

export type ConstructionObjectStatus = 'archive' | 'current';

export interface IConstructionObject {
  id: string;
  name: string;
  area: number | null;
  address: string;
  /** Заказчик / девелопер */
  customer: string | null;
  latitude: number | null;
  longitude: number | null;
  status: ConstructionObjectStatus;
  project_id: string | null;
  project_name: string | null;
  /** Дата ввода (последнего этапа), YYYY-MM-DD */
  commissioning_date: string | null;
  /** Дата ввода первого этапа, если комплекс вводился очередями; иначе null */
  commissioning_start_date: string | null;
  sort_order: number;
  /** Число фото объекта и id обложки (фото с минимальным sort_order) */
  photo_count: number;
  cover_photo_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface IConstructionObjectInput {
  name: string;
  area: number | null;
  address: string;
  customer: string | null;
  latitude: number | null;
  longitude: number | null;
  status: ConstructionObjectStatus;
  project_id: string | null;
  commissioning_date: string | null;
  commissioning_start_date: string | null;
}
