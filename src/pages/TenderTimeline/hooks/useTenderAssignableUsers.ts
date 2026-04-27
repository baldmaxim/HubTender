import { useCallback, useEffect, useState } from 'react';
import type { TimelineUserRef } from '../../../lib/supabase/types';
import { listTimelineAssignableUsers } from '../../../lib/api/timeline';
import { DEFAULT_TENDER_TEAMS, normalizeFullName } from '../utils/timeline.utils';

interface UseTenderAssignableUsersResult {
  users: TimelineUserRef[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTenderAssignableUsers(): UseTenderAssignableUsersResult {
  const [users, setUsers] = useState<TimelineUserRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const configuredNames = new Set(
        DEFAULT_TENDER_TEAMS.flatMap((team) => team.members).map((fullName) => normalizeFullName(fullName)),
      );

      const data = await listTimelineAssignableUsers();
      const matchedUsers = data
        .filter((user) => configuredNames.has(normalizeFullName(user.full_name)))
        .sort((left, right) => left.full_name.localeCompare(right.full_name, 'ru-RU'));

      setUsers(matchedUsers);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить фиксированный состав команд';
      setError(message);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { users, loading, error, refetch };
}
