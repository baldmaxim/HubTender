/**
 * Типы для страницы коммерции
 */

import type { ClientPosition, MarkupSequences, BaseCosts } from '../../lib/supabase';

export interface PositionWithCommercialCost extends ClientPosition {
  commercial_total?: number;
  base_total?: number;
  markup_percentage?: number;
  items_count?: number;
  material_cost_total?: number;
  work_cost_total?: number;
  is_leaf?: boolean;
}

export interface MarkupTactic {
  id: string;
  name: string;
  is_global: boolean;
  created_at: string;
  sequences?: MarkupSequences;
  base_costs?: BaseCosts;
}

export interface TenderOption {
  value: string;
  label: string;
  clientName: string;
}
