import { useCallback, useEffect, useState } from 'react';
import { fetchCostBenchmarks, type CostBenchmarkReport } from '../../../lib/api/costBenchmarks';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';

/** Эталоны удельных показателей выбранного тендера. */
export function useCostBenchmarks(tenderId: string | null) {
  const [period, setPeriod] = useState(24);
  const [report, setReport] = useState<CostBenchmarkReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string, months: number, silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      setReport(await fetchCostBenchmarks(id, months));
      setError(null);
    } catch (e) {
      console.error('Ошибка загрузки эталонов:', e);
      setError('Не удалось загрузить сравнение с эталонами');
      if (!silent) setReport(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tenderId) void load(tenderId, period, false);
    else setReport(null);
  }, [tenderId, period, load]);

  // Коммерческие суммы меняются после пересчёта — перечитываем по событию тендера.
  useRealtimeTopic(
    tenderId ? `tender:${tenderId}` : null,
    useCallback(() => {
      if (tenderId) void load(tenderId, period, true);
    }, [tenderId, period, load]),
  );

  const reload = useCallback(() => {
    if (tenderId) void load(tenderId, period, true);
  }, [tenderId, period, load]);

  return { report, loading, error, period, setPeriod, reload };
}
