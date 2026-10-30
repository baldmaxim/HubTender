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
 * если такого тендера в списке нет — список перечитывается (прогон мог появиться только что),
 * а если и после этого нет — прежнее поведение (первый из списка).
 * requestedRunId (из ?runId=) так же выбирает прогон тендера.
 */
export const useAutopriceList = (requestedTenderId: string | null, requestedRunId: string | null = null) => {
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
  const requestedRunRef = useRef(requestedRunId);
  requestedRunRef.current = requestedRunId;
  const [tendersReload, setTendersReload] = useState(0);
  const [runsReload, setRunsReload] = useState(0);
  const handledTenderRef = useRef(requestedTenderId);
  const handledRunRef = useRef(requestedRunId);
  const runsTenderRef = useRef<string | null>(null);

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
  }, [tendersReload]);

  // Пришли за тендером/прогоном, которых в загруженном списке ещё нет (первое применение аналога
  // создаёт прогон на лету) — перечитываем списки один раз на каждое новое значение параметра.
  useEffect(() => {
    if (requestedTenderId && requestedTenderId !== handledTenderRef.current) {
      handledTenderRef.current = requestedTenderId;
      if (!tenders.some((t) => t.tender_id === requestedTenderId)) setTendersReload((n) => n + 1);
    }
  }, [requestedTenderId, tenders]);

  useEffect(() => {
    if (requestedRunId && requestedRunId !== handledRunRef.current) {
      handledRunRef.current = requestedRunId;
      setRunsReload((n) => n + 1);
    }
  }, [requestedRunId]);

  // Параметр сменился при уже открытой (keep-alive) вкладке — переключаем тендер.
  useEffect(() => {
    if (requestedTenderId && tenders.some((t) => t.tender_id === requestedTenderId)) {
      setTenderId(requestedTenderId);
    }
  }, [requestedTenderId, tenders]);

  useEffect(() => {
    // Повторное чтение прогонов того же тендера не сбрасывает выбор и список позиций.
    if (runsTenderRef.current !== tenderId) {
      runsTenderRef.current = tenderId;
      setRuns([]);
      setRunId(null);
      setReviews([]);
    }
    if (!tenderId) return;
    let cancelled = false;
    fetchAutopriceRuns(tenderId)
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort(byImportedDesc);
        const active = activeRuns(sorted);
        setRuns(sorted);
        const wanted = active.find((r) => r.id === requestedRunRef.current)?.id;
        setRunId((prev) => wanted ?? (prev && active.some((r) => r.id === prev) ? prev : (active[0]?.id ?? null)));
      })
      .catch((e: unknown) => !cancelled && setError(autopriceErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [tenderId, runsReload]);

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
