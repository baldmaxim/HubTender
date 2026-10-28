import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activeRuns,
  autopriceErrorMessage,
  fetchAutopriceReviews,
  fetchAutopriceRuns,
  fetchAutopriceTenders,
} from '../../../lib/api/autoprice';
import type { IAutopriceRun, IAutopriceTender, IReviewRow } from '../types';

const byImportedDesc = (a: IAutopriceRun, b: IAutopriceRun): number =>
  b.imported_at.localeCompare(a.imported_at);

/**
 * Тендеры с прогонами авторасценки → прогоны тендера → позиции выбранного прогона.
 * requestedTenderId (из ?tenderId=) выбирает тендер при загрузке списка и при смене параметра;
 * если такого тендера в списке нет — прежнее поведение (первый из списка).
 */
export const useAutopriceList = (requestedTenderId: string | null) => {
  const [tenders, setTenders] = useState<IAutopriceTender[]>([]);
  const [tendersLoading, setTendersLoading] = useState(true);
  const [tenderId, setTenderId] = useState<string | null>(null);
  const [runs, setRuns] = useState<IAutopriceRun[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<IReviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewsReq = useRef(0);
  const requestedRef = useRef(requestedTenderId);
  requestedRef.current = requestedTenderId;

  useEffect(() => {
    let cancelled = false;
    fetchAutopriceTenders()
      .then((list) => {
        if (cancelled) return;
        setTenders(list);
        const requested = list.find((t) => t.tender_id === requestedRef.current)?.tender_id;
        setTenderId((prev) => prev ?? requested ?? list[0]?.tender_id ?? null);
      })
      .catch((e: unknown) => !cancelled && setError(autopriceErrorMessage(e)))
      .finally(() => !cancelled && setTendersLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Параметр сменился при уже открытой (keep-alive) вкладке — переключаем тендер.
  useEffect(() => {
    if (requestedTenderId && tenders.some((t) => t.tender_id === requestedTenderId)) {
      setTenderId(requestedTenderId);
    }
  }, [requestedTenderId, tenders]);

  useEffect(() => {
    setRuns([]);
    setRunId(null);
    setReviews([]);
    if (!tenderId) return;
    let cancelled = false;
    fetchAutopriceRuns(tenderId)
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort(byImportedDesc);
        setRuns(sorted);
        setRunId(activeRuns(sorted)[0]?.id ?? null);
      })
      .catch((e: unknown) => !cancelled && setError(autopriceErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [tenderId]);

  const loadReviews = useCallback(async (sessionId: string, silent: boolean) => {
    const req = ++reviewsReq.current;
    if (!silent) setLoading(true);
    try {
      const res = await fetchAutopriceReviews(sessionId);
      if (req !== reviewsReq.current) return;
      setReviews(res.reviews ?? []);
      setError(null);
    } catch (e) {
      if (req === reviewsReq.current) setError(autopriceErrorMessage(e));
    } finally {
      if (req === reviewsReq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (runId) void loadReviews(runId, false);
  }, [runId, loadReviews]);

  const reload = useCallback(() => {
    if (runId) void loadReviews(runId, true);
  }, [runId, loadReviews]);

  return { tenders, tendersLoading, tenderId, setTenderId, runs, runId, setRunId, reviews, loading, error, reload };
};
