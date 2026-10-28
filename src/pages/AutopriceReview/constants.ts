import type {
  AutopriceBasis,
  AutopriceStatus,
  FindingResolution,
  FindingSeverity,
  MachineChangedField,
} from './types';

/** Роли, которым разрешено «Подтвердить» (зеркало AutopriceApproverRoles на бэкенде). */
export const AUTOPRICE_APPROVER_ROLES: readonly string[] = ['veduschiy_inzhener', 'administrator'];

export const BASIS_LABELS: Record<AutopriceBasis, string> = {
  PD_CONFIRMED: 'Подтверждено ПД',
  ASSUMED: 'Допущение',
  NOT_IN_PD: 'Нет в ПД',
  RESERVE: 'Резерв',
};

export const BASIS_COLORS: Record<AutopriceBasis, string> = {
  PD_CONFIRMED: 'green',
  ASSUMED: 'orange',
  NOT_IN_PD: 'red',
  RESERVE: 'blue',
};

export const STATUS_LABELS: Record<AutopriceStatus, string> = {
  pending: 'Не начато',
  in_progress: 'В работе',
  needs_customer: 'Ждём Заказчика',
  returned: 'Возвращено',
  approved: 'Подтверждено',
  excluded: 'Исключено',
};

export const STATUS_COLORS: Record<AutopriceStatus, string> = {
  pending: 'default',
  in_progress: 'processing',
  needs_customer: 'purple',
  returned: 'orange',
  approved: 'green',
  excluded: 'default',
};

export const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  high: 'Высокая',
  medium: 'Средняя',
  low: 'Низкая',
};

export const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  high: 'red',
  medium: 'orange',
  low: 'blue',
};

export const RESOLUTION_OPTIONS: { value: FindingResolution; label: string }[] = [
  { value: 'fixed', label: 'Исправлено' },
  { value: 'not_duplicate', label: 'Не дубль' },
  { value: 'moved', label: 'Перенесено' },
  { value: 'other', label: 'Другое' },
];

export const ACTION_LABELS: Record<string, string> = {
  load: 'Загружено',
  edit: 'Правка',
  start: 'Взято в работу',
  approve: 'Подтверждено',
  return: 'Возвращено',
  needs_customer: 'Ждём Заказчика',
  exclude: 'Исключено',
  reopen: 'Переоткрыто',
};

/** Какое поле строки отражает изменение из `changed`. */
export const CHANGED_TO_COLUMN: Record<MachineChangedField, 'name' | 'unit_rate' | 'conversion' | 'consumption'> = {
  unit_rate: 'unit_rate',
  conversion_coefficient: 'conversion',
  consumption_coefficient: 'consumption',
  work_name_id: 'name',
  material_name_id: 'name',
  material_type: 'name',
};

/** Высота строки списка — фиксирована (виртуализация, 500+ строк). */
export const LIST_ROW_HEIGHT = 48;
export const LIST_ROW_HEIGHT_PHONE = 64;
