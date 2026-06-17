import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getTenderById } from '../lib/api/fi';
import { apiFetch } from '../lib/api/client';
import { useRealtimeRefetch } from '../lib/realtime/useRealtimeRefetch';
import { checkTenderDeadline } from '../utils/deadlineCheck';
import type { DeadlineCheckResult, TenderDeadlineExtension } from '../lib/supabase/types';

// Должен совпадать с ROLES_WITH_FULL_ACCESS в src/utils/deadlineCheck.ts —
// привилегированные роли не падают в fail-closed при сетевой ошибке.
const ROLES_WITH_FULL_ACCESS = ['administrator', 'director', 'developer', 'veduschiy_inzhener'];

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

  const fetchDeadlineInfo = useCallback(
    async () => {
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

      // Привилегированные роли пропускаем без fetch — сетевая ошибка их
      // не должна залочить (fail-closed ниже).
      if (user.role_code && ROLES_WITH_FULL_ACCESS.includes(user.role_code)) {
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
        // Fail-closed: при ошибке загрузки дедлайна закрываем редактирование
        // для не-привилегированных юзеров. Раньше здесь было canEdit: true —
        // любой network blip разлочивал инженеров/старших группы.
        setDeadlineStatus({
          isExpired: true,
          canEdit: false,
          deadline: null,
          isExtended: false
        });
      } finally {
        setLoading(false);
      }
    },
    [tenderId, user],
  );

  useEffect(() => {
    fetchDeadlineInfo();
  }, [fetchDeadlineInfo]);

  // Realtime: админ открывает доступ → UPDATE users.tender_deadline_extensions
  // → NOTIFY на топик user:<id>. Пересчитываем дедлайн без перезагрузки страницы.
  useRealtimeRefetch(
    user?.id && tenderId ? `user:${user.id}` : null,
    () => {
      void fetchDeadlineInfo();
    },
  );

  return {
    ...deadlineStatus,
    loading
  };
};
