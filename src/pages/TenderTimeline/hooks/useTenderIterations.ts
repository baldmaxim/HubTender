import { useCallback, useEffect, useState } from 'react';
import { listTimelineGroupIterations } from '../../../lib/api/timeline';
import type { TenderIterationWithRelations } from '../../../lib/supabase/types';

interface UseTenderIterationsResult {
  iterations: TenderIterationWithRelations[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTenderIterations(
  groupId: string | null,
  userId: string | null
): UseTenderIterationsResult {
  const [iterations, setIterations] = useState<TenderIterationWithRelations[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!groupId || !userId) {
      setIterations([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await listTimelineGroupIterations(groupId, userId);
      setIterations((data || []) as unknown as TenderIterationWithRelations[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить итерации';
      setError(message);
      setIterations([]);
    } finally {
      setLoading(false);
    }
  }, [groupId, userId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { iterations, loading, error, refetch };
}
