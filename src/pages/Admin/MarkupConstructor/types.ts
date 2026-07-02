import type { MarkupStep } from '../../../lib/supabase';
// MarkupStep — единый тип из lib/supabase (локальный дубль удалён,
// чтобы структуры шага не расходились).
export type { MarkupStep } from '../../../lib/supabase';

export type TabKey =
  | 'works'
  | 'materials'
  | 'subcontract_works'
  | 'subcontract_materials'
  | 'work_comp'
  | 'material_comp';

export type ActionType = 'multiply' | 'divide' | 'add' | 'subtract';
export type OperandType = 'markup' | 'step' | 'number';
export type MultiplyFormat = 'addOne' | 'direct';
export type InputMode = 'select' | 'manual';

export type MarkupSequences = {
  [K in TabKey]: MarkupStep[];
};

export type BaseCosts = {
  [K in TabKey]: number;
};

export type OperandState<T> = Record<TabKey, T>;