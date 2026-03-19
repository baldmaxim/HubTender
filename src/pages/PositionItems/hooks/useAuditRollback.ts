import { useState } from 'react';
import { message } from 'antd';
import { updateBoqItemWithAudit } from '../../../lib/supabaseWithAudit';
import { useAuth } from '../../../contexts/AuthContext';
import type { BoqItemAudit } from '../../../types/audit';
import type { BoqItemInsert } from '../../../lib/supabase';

interface UseAuditRollbackReturn {
  rollback: (record: BoqItemAudit) => Promise<void>;
  rolling: boolean;
}

/**
 * Хук для восстановления BOQ item к предыдущей версии из audit log
 *
 * @returns Функция rollback и состояние загрузки
 */
export function useAuditRollback(): UseAuditRollbackReturn {
  const { user } = useAuth();
  const [rolling, setRolling] = useState(false);

  const rollback = async (record: BoqItemAudit) => {
    // Проверка возможности rollback
    if (!record.old_data) {
      message.error('Невозможно восстановить: нет данных предыдущей версии');
      return;
    }

    if (record.operation_type === 'DELETE') {
      message.error('Невозможно восстановить удаленный элемент');
      return;
    }

    setRolling(true);

    try {
      // Восстанавливаем значения из old_data
      const { id, created_at, updated_at, ...rollbackData } = record.old_data;
      await updateBoqItemWithAudit(
        user?.id,
        record.boq_item_id,
        rollbackData as Partial<BoqItemInsert>
      );

      message.success('Версия успешно восстановлена');

      // Перезагрузка страницы для обновления данных
      // Альтернатива: вызвать refetch из контекста или props
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (err) {
      console.error('[useAuditRollback] Ошибка восстановления:', err);

      const errorMessage =
        err instanceof Error ? err.message : 'Неизвестная ошибка восстановления';

      message.error(`Ошибка восстановления: ${errorMessage}`);
    } finally {
      setRolling(false);
    }
  };

  return {
    rollback,
    rolling,
  };
}
