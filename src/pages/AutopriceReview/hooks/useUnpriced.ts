import { useEffect, useMemo, useRef, useState } from 'react';
import { autopriceErrorMessage, fetchAutopriceUnpriced } from '../../../lib/api/autoprice';
import type { IUnpricedRow } from '../types';
import { DEFAULT_UNPRICED_FILTERS, filterUnpriced, type IUnpricedFilters } from '../utils/unpricedPolicy';

/** Позиции, не попавшие в расценку выбранного прогона; перезагружается при смене прогона. */
export const useUnpriced = (runId: string | null) => {
  const [rows, setRows] = useState<IUnpricedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<IUnpricedFilters>(DEFAULT_UNPRICED_FILTERS);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    setRows([]);
    setError(null);
    setFilters(DEFAULT_UNPRICED_FILTERS);
    if (!runId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAutopriceUnpriced(runId)
      .then((res) => id === req.current && setRows(res))
      .catch((e: unknown) => id === req.current && setError(autopriceErrorMessage(e)))
      .finally(() => id === req.current && setLoading(false));
  }, [runId]);

  const visible = useMemo(() => filterUnpriced(rows, filters), [rows, filters]);
  // Счётчик переключателя не зависит от выбранных фильтров: строки при фильтрах по умолчанию.
  const defaultCount = useMemo(() => filterUnpriced(rows, DEFAULT_UNPRICED_FILTERS).length, [rows]);

  return { rows, visible, defaultCount, loading, error, filters, setFilters };
};
