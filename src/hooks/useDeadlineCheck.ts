import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getTenderById } from '../lib/api/fi';
import { apiFetch } from '../lib/api/client';
import { checkTenderDeadline } from '../utils/deadlineCheck';
import type { DeadlineCheckResult, TenderDeadlineExtension } from '../lib/supabase/types';

/**
 * Хук для проверки дедлайна тендера и прав доступа пользователя
 * @param tenderId - ID тендера
 * @returns Статус дедлайна и флаги доступа
 */
export const useDeadlineCheck = (tenderId: string | undefined) => {
  const { user } = useAuth();
  const [deadlineStatus, setDeadlineStatus] = useState<DeadlineCheckResult>({
    isExpired: false,
    canEdit: true,
    deadline: null,
    isExtended: false
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDeadlineInfo = async () => {
      if (!tenderId || !user) {
        setDeadlineStatus({
          isExpired: false,
          canEdit: true,
          deadline: null,
          isExtended: false
        });
        setLoading(false);
        return;
      }

      try {
        // Дедлайн тендера (Go BFF)
        const tender = await getTenderById(tenderId);

        // Продления текущего пользователя (Go BFF, user_id из JWT)
        const extRes = await apiFetch<{ data: TenderDeadlineExtension[] }>(
          '/api/v1/me/deadline-extensions',
        );
        const extensions: TenderDeadlineExtension[] = extRes.data || [];

        const result = checkTenderDeadline(
          tenderId,
          tender?.submission_deadline || null,
          user,
          extensions
        );

        setDeadlineStatus(result);
      } catch (error) {
        console.error('Ошибка проверки дедлайна:', error);
        // В случае ошибки разрешаем редактирование
        setDeadlineStatus({
          isExpired: false,
          canEdit: true,
          deadline: null,
          isExtended: false
        });
      } finally {
        setLoading(false);
      }
    };

    fetchDeadlineInfo();
  }, [tenderId, user]);

  return {
    ...deadlineStatus,
    loading
  };
};
