// Чистые хелперы выжимки для руководства. Без React — проверяются
// scripts/checks/briefPolicy.check.mjs.
import type { CostBenchmarkReport, CostBenchmarkRow } from '../api/costBenchmarks';

/** Сколько категорий берётся в блок цифр, если проверяющий их не выбрал. */
export const AUTO_FACT_LIMIT = 8;
export const MAX_BRIEF_LENGTH = 20000;

export interface BriefFact {
  category_id: string;
  name: string;
  unit: string;
  volume: number | null;
  commercial_total: number;
  per_volume_unit: number | null;
  per_area_sp: number | null;
  /** Доля в коммерческой стоимости тендера, 0..1; null — итог неизвестен. */
  share: number | null;
}

const toFact = (row: CostBenchmarkRow, total: number): BriefFact => ({
  category_id: row.category_id,
  name: row.name,
  unit: row.unit,
  volume: row.volume,
  commercial_total: row.commercial_total,
  per_volume_unit: row.per_volume_unit?.value ?? null,
  per_area_sp: row.per_area_sp.value,
  share: total > 0 ? row.commercial_total / total : null,
});

/** Категории, доступные для выбора в блок цифр (только уровень категории). */
export function briefCategoryRows(report: CostBenchmarkReport | null): CostBenchmarkRow[] {
  return (report?.rows ?? []).filter((r) => r.level === 'category');
}

/**
 * Факты выжимки. Выбор проверяющего сохраняет его порядок и молча пропускает
 * категории, которых больше нет в расчёте; без выбора — крупнейшие по сумме.
 */
export function pickBriefFacts(
  report: CostBenchmarkReport | null,
  selectedIds: string[] | null,
  limit = AUTO_FACT_LIMIT,
): BriefFact[] {
  if (!report) return [];
  const total = report.rows.find((r) => r.level === 'total')?.commercial_total ?? 0;
  const cats = briefCategoryRows(report);
  if (selectedIds && selectedIds.length > 0) {
    const byId = new Map(cats.map((c) => [c.category_id, c]));
    return selectedIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toFact(row, total)] : [];
    });
  }
  return cats
    .filter((c) => c.commercial_total > 0)
    .sort((a, b) => b.commercial_total - a.commercial_total)
    .slice(0, limit)
    .map((c) => toFact(c, total));
}

/** Итог тендера на м² СП — первая строка блока цифр. */
export function briefTotalPerSp(report: CostBenchmarkReport | null): number | null {
  return report?.rows.find((r) => r.level === 'total')?.per_area_sp.value ?? null;
}

const money = (v: number | null): string =>
  v === null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('ru-RU');

/** Строка факта для Excel и копирования: «Монолит — 30 000 ₽/м3, 12 500 ₽/м² СП, 24%». */
export function formatBriefFact(f: BriefFact): string {
  const parts: string[] = [];
  if (f.per_volume_unit !== null) parts.push(`${money(f.per_volume_unit)} ₽/${f.unit || 'ед.'}`);
  parts.push(`${money(f.per_area_sp)} ₽/м² СП`);
  if (f.share !== null) parts.push(`${Math.round(f.share * 100)}%`);
  return `${f.name} — ${parts.join(', ')}`;
}

/** Выбор совпадает с автоматическим — сохраняем null, чтобы выбор следовал за расчётом. */
export function normalizeSelection(selectedIds: string[], report: CostBenchmarkReport | null): string[] | null {
  if (selectedIds.length === 0) return null;
  const auto = pickBriefFacts(report, null).map((f) => f.category_id);
  const same = auto.length === selectedIds.length && auto.every((id, i) => id === selectedIds[i]);
  return same ? null : selectedIds;
}
