import { apiFetch } from './client';

/** Итог по странице за период (GET /admin/usage/page-stats). */
export interface IPageStatsRow {
  page: string;
  views: number;
  users: number;
  last_viewed_at: string;
}

/** Просмотры страницы за один день (по Москве). */
export interface IPageStatsCell {
  page: string;
  /** YYYY-MM-DD */
  day: string;
  views: number;
  users: number;
}

export interface IPageStats {
  days: number;
  /** YYYY-MM-DD, первый день периода. */
  from: string;
  /** YYYY-MM-DD, последний день периода (сегодня). */
  to: string;
  pages: IPageStatsRow[];
  cells: IPageStatsCell[];
}

/** Записать просмотр страницы. Учёт вторичен, поэтому ошибки наружу не выходят. */
export const sendPageView = async (page: string): Promise<void> => {
  try {
    await apiFetch<void>('/api/v1/usage/page-view', {
      method: 'POST',
      body: JSON.stringify({ page }),
    });
  } catch {
    // Статистика не должна мешать работе: молча пропускаем.
  }
};

export const fetchPageStats = async (days: number): Promise<IPageStats> => {
  const res = await apiFetch<{ data: IPageStats }>(`/api/v1/admin/usage/page-stats?days=${days}`);
  return res.data;
};
