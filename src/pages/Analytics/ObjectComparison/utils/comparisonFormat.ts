import type { ComparisonRow, TenderCosts } from '../types';

export const formatNum = (value: number) =>
  value.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

export const formatPerUnit = (value: number) =>
  value > 0
    ? value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

export const tenderLabel = (info: { title: string; version?: number } | null, fallback: string) => {
  if (!info) return fallback;
  return `${info.title} (v${info.version || 1})`;
};

export function getDiff(r: ComparisonRow, field: keyof TenderCosts) {
  const v0 = (r.tenders[0]?.[field] as number) ?? 0;
  const v1 = (r.tenders[1]?.[field] as number) ?? 0;
  return { value: v1 - v0, percent: v0 > 0 ? ((v1 - v0) / v0) * 100 : 0 };
}
