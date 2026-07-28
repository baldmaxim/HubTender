import type { ColumnsType } from 'antd/es/table';
import type { ComparisonRow, TenderCosts } from '../types';

/**
 * Сумма ширин листовых колонок — значение для `scroll.x`.
 * Группы (колонки тендеров, «Разница») разворачиваем в children.
 * Ширина таблицы обязана совпадать с суммой объявленных ширин: иначе браузер растягивает
 * колонки на дробные величины, а закреплённая шапка (rc-table FixedHolder) берёт их уже
 * измеренными/округлёнными — границы шапки и тела расходятся.
 */
export const sumLeafWidths = (cols: ColumnsType<ComparisonRow>): number =>
  cols.reduce(
    (acc, col) =>
      acc +
      ('children' in col && col.children
        ? sumLeafWidths(col.children as ColumnsType<ComparisonRow>)
        : Number(col.width) || 0),
    0,
  );

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
