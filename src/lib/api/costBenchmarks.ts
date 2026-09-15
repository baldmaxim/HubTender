// Конвейер проверки: эталоны удельных показателей тендера.
// ₽ на единицу объёма категории и ₽ на м² общей площади по СП сравниваются с
// ручным диапазоном из справочника (важнее) или со статистикой согласованных
// тендеров. Расчёт — backend/internal/analytics/costbenchmark.
import { apiFetch } from './client';
import type { ConstructionScopeType, HousingClassType } from '../types';

export type BenchmarkMetricKind = 'per_volume_unit' | 'per_area_sp';
export type BenchmarkLevel = 'total' | 'category' | 'detail';
export type BenchmarkStatus =
  | 'WITHIN_RANGE'
  | 'ABOVE_RANGE'
  | 'BELOW_RANGE'
  | 'NO_VALUE'
  | 'NO_REFERENCE'
  | 'CALCULATION_NOT_READY';
export type BenchmarkSource =
  | 'manual_exact'
  | 'manual_class'
  | 'manual_scope'
  | 'manual_any'
  | 'history_class'
  | 'history_all';

export interface BenchmarkReference {
  source: BenchmarkSource;
  range_id?: string;
  note?: string | null;
  min: number | null;
  max: number | null;
  median?: number;
  tenders_count?: number;
}

export interface BenchmarkAssessment {
  value: number | null;
  status: BenchmarkStatus;
  reference: BenchmarkReference | null;
  deviation_percent: number | null;
  /** Ручной диапазон использован, но медиана истории того же класса вне его. */
  history_conflict: boolean;
  history_median: number | null;
  history_tenders: number;
}

export interface CostBenchmarkRow {
  level: BenchmarkLevel;
  category_id: string;
  detail_id: string;
  name: string;
  location: string;
  unit: string;
  volume: number | null;
  commercial_total: number;
  /** null у строки «Итого по тендеру». */
  per_volume_unit: BenchmarkAssessment | null;
  per_area_sp: BenchmarkAssessment;
}

export interface CostBenchmarkReport {
  tender_id: string;
  housing_class: HousingClassType | null;
  construction_scope: ConstructionScopeType | null;
  area_sp: number | null;
  period_months: number;
  calculation_ready: boolean;
  history_tenders: number;
  rows: CostBenchmarkRow[];
  summary: { above: number; below: number; within: number; no_reference: number; conflicts: number };
}

export const BENCHMARK_PERIODS = [6, 12, 24, 36] as const;

export async function fetchCostBenchmarks(tenderId: string, periodMonths = 24): Promise<CostBenchmarkReport> {
  const res = await apiFetch<{ data: CostBenchmarkReport }>(
    `/api/v1/tenders/${tenderId}/cost-benchmarks?period_months=${periodMonths}`,
    { timeoutMs: 60_000 },
  );
  return res.data;
}

export interface BenchmarkRangeInput {
  metric_kind: BenchmarkMetricKind;
  level: BenchmarkLevel;
  cost_category_id: string | null;
  detail_cost_category_id: string | null;
  housing_class: HousingClassType | null;
  construction_scope: ConstructionScopeType | null;
  min_value: number | null;
  max_value: number | null;
  note: string | null;
}

export interface BenchmarkRange extends BenchmarkRangeInput {
  id: string;
  target_name: string;
  updated_at: string;
  updated_by_name: string | null;
}

export async function listBenchmarkRanges(): Promise<BenchmarkRange[]> {
  const res = await apiFetch<{ data: BenchmarkRange[] }>('/api/v1/benchmark-ranges');
  return res.data ?? [];
}

export async function createBenchmarkRange(input: BenchmarkRangeInput): Promise<string> {
  const res = await apiFetch<{ data: { id: string } }>('/api/v1/benchmark-ranges', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data.id;
}

export async function updateBenchmarkRange(id: string, input: BenchmarkRangeInput): Promise<void> {
  await apiFetch<void>(`/api/v1/benchmark-ranges/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export async function deleteBenchmarkRange(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/benchmark-ranges/${id}`, { method: 'DELETE' });
}
