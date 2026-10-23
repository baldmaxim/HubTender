import dayjs from 'dayjs';
import type { IPageStats } from '../../../../lib/api/usage';
import { PAGE_LABELS } from '../../../../lib/types/types';
import { getMenuLeaves } from './menuLeaves';

/** Раздел для страниц из статистики, которых нет в боковом меню. */
export const OTHER_GROUP = 'Прочие';

/** Одна колонка-период в тепловой карте: день или неделя. */
export interface IUsageBucket {
  /** Первый день колонки, YYYY-MM-DD. */
  key: string;
  days: string[];
  label: string;
  title: string;
}

export interface IUsageCell {
  views: number;
  /** Для недели — сумма уникальных пользователей по дням. */
  users: number;
}

export interface IUsageRow {
  page: string;
  label: string;
  group: string;
  views: number;
  users: number;
  lastViewedAt: string | null;
  /** Ячейки в порядке колонок; null — просмотров не было. */
  cells: (IUsageCell | null)[];
}

export interface IUsageTable {
  buckets: IUsageBucket[];
  rows: IUsageRow[];
  /** Максимум просмотров в одной ячейке — для шкалы интенсивности. */
  maxCellViews: number;
}

const DAY_FORMAT = 'YYYY-MM-DD';

/** Колонки периода: по дням, для длинных периодов (byWeek) — по 7 дней от начала. */
export const buildBuckets = (from: string, to: string, byWeek: boolean): IUsageBucket[] => {
  const days: string[] = [];
  const end = dayjs(to);
  for (let d = dayjs(from); !d.isAfter(end, 'day'); d = d.add(1, 'day')) days.push(d.format(DAY_FORMAT));

  const step = byWeek ? 7 : 1;
  const buckets: IUsageBucket[] = [];
  for (let i = 0; i < days.length; i += step) {
    const chunk = days.slice(i, i + step);
    const first = dayjs(chunk[0]);
    const last = dayjs(chunk[chunk.length - 1]);
    buckets.push({
      key: chunk[0],
      days: chunk,
      label: byWeek ? first.format('DD.MM') : first.format('DD'),
      title: chunk.length > 1 ? `${first.format('DD.MM.YYYY')} — ${last.format('DD.MM.YYYY')}` : first.format('DD.MM.YYYY'),
    });
  }
  return buckets;
};

/**
 * Строки таблицы: все страницы бокового меню (в том числе без просмотров), затем
 * «Прочие» — страницы из статистики, которых в меню нет.
 */
export const buildUsageTable = (stats: IPageStats, byWeek: boolean): IUsageTable => {
  const buckets = buildBuckets(stats.from, stats.to, byWeek);
  const bucketOfDay = new Map<string, number>();
  buckets.forEach((b, index) => b.days.forEach((day) => bucketOfDay.set(day, index)));

  const totals = new Map(stats.pages.map((p) => [p.page, p]));
  const cellsOfPage = new Map<string, (IUsageCell | null)[]>();
  let maxCellViews = 0;
  for (const c of stats.cells) {
    const index = bucketOfDay.get(c.day);
    if (index === undefined) continue;
    let cells = cellsOfPage.get(c.page);
    if (!cells) {
      cells = buckets.map(() => null);
      cellsOfPage.set(c.page, cells);
    }
    const prev = cells[index];
    const next = { views: (prev?.views ?? 0) + c.views, users: (prev?.users ?? 0) + c.users };
    cells[index] = next;
    if (next.views > maxCellViews) maxCellViews = next.views;
  }

  const makeRow = (page: string, label: string, group: string): IUsageRow => {
    const total = totals.get(page);
    return {
      page,
      label,
      group,
      views: total?.views ?? 0,
      users: total?.users ?? 0,
      lastViewedAt: total?.last_viewed_at ?? null,
      cells: cellsOfPage.get(page) ?? buckets.map(() => null),
    };
  };

  const leaves = getMenuLeaves();
  const inMenu = new Set(leaves.map((l) => l.page));
  const rows = leaves.map((l) => makeRow(l.page, l.label, l.group));
  for (const p of stats.pages) {
    if (!inMenu.has(p.page)) rows.push(makeRow(p.page, PAGE_LABELS[p.page] ?? p.page, OTHER_GROUP));
  }
  return { buckets, rows, maxCellViews };
};

/**
 * Сортировка по просмотрам. unusedFirst — по возрастанию (неиспользуемые сверху),
 * иначе по убыванию. «Прочие» всегда после страниц меню.
 */
export const sortUsageRows = (rows: IUsageRow[], unusedFirst: boolean): IUsageRow[] => {
  const dir = unusedFirst ? 1 : -1;
  return [...rows].sort((a, b) => {
    const otherA = a.group === OTHER_GROUP ? 1 : 0;
    const otherB = b.group === OTHER_GROUP ? 1 : 0;
    if (otherA !== otherB) return otherA - otherB;
    return dir * (a.views - b.views) || a.label.localeCompare(b.label, 'ru');
  });
};
