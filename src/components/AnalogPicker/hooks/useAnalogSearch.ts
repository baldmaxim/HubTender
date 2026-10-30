import { useCallback, useEffect, useRef, useState } from 'react';
import { analogErrorMessage, searchAnalogs } from '../../../lib/api/analogs';
import type { IAnalogSearchResponse } from '../../../lib/api/analogs.types';

const LIMITS = [3, 10, 30] as const;

/** Поиск аналогов: фраза (по умолчанию — название цели), порции 3 → 10 → 30. */
export const useAnalogSearch = (positionId: string) => {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState<string | undefined>(undefined);
  const [limit, setLimit] = useState<number>(LIMITS[0]);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<IAnalogSearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    setError(null);
    searchAnalogs(positionId, applied, limit)
      .then((res) => {
        if (id !== req.current) return;
        setData(res);
        // Первая выдача: в поле — полное название цели, как его искал сервер.
        if (applied === undefined) setQuery((prev) => (prev === '' ? res.query : prev));
      })
      .catch((e: unknown) => id === req.current && setError(analogErrorMessage(e)))
      .finally(() => id === req.current && setLoading(false));
  }, [positionId, applied, limit, reload]);

  const submit = useCallback(() => {
    setApplied(query.trim() || undefined);
    setLimit(LIMITS[0]);
    setReload((n) => n + 1);
  }, [query]);

  const showMore = useCallback(() => {
    setLimit((l) => LIMITS.find((x) => x > l) ?? l);
  }, []);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  return { query, setQuery, data, loading, error, submit, showMore, refresh, canShowMore: !!data?.has_more && limit < LIMITS[2] };
};
