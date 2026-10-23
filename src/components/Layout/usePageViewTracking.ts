import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { sendPageView } from '../../lib/api/usage';
import { getPageViewKey } from './pageViewKey';

/** Одну и ту же страницу чаще чем раз в 10 минут не отправляем. */
const DEDUPE_MS = 10 * 60 * 1000;

// userId|page → время последней отправки. Живёт до перезагрузки вкладки браузера.
const lastSentAt = new Map<string, number>();

/**
 * Учёт просмотров страниц для «Использования портала». Срабатывает при смене
 * активной страницы (MainLayout не заморожен, в отличие от скрытых вкладок).
 */
export const usePageViewTracking = (): void => {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    const page = getPageViewKey(pathname);
    if (!page) return;

    const dedupeKey = `${userId}|${page}`;
    const now = Date.now();
    const prev = lastSentAt.get(dedupeKey);
    if (prev !== undefined && now - prev < DEDUPE_MS) return;
    lastSentAt.set(dedupeKey, now);

    void sendPageView(page);
  }, [pathname, userId]);
};
