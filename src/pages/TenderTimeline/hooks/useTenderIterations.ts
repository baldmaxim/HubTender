import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
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
      const { data, error: fetchError } = await supabase
        .from('tender_iterations')
        .select(`
          id,
          group_id,
          user_id,
          iteration_number,
          user_comment,
          user_amount,
          submitted_at,
          manager_id,
          manager_comment,
          manager_responded_at,
          approval_status,
          created_at,
          updated_at,
          user:users!user_id (
            id,
            full_name,
            role_code
          ),
          manager:users!manager_id (
            id,
            full_name,
            role_code
          )
        `)
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .order('iteration_number', { ascending: true });

      if (fetchError) {
        throw fetchError;
      }

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
