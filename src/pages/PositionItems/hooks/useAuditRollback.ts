import { useState } from 'react';
import { message } from 'antd';
import { apiFetch } from '../../../lib/api/client';
import { updateBoqItemWithAudit } from '../../../lib/api/boq';
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
    if (!record.old_data) {
      message.error('Невозможно восстановить: нет данных предыдущей версии');
      return;
    }

    setRolling(true);

    try {
      if (record.operation_type === 'DELETE') {
        // Сервер по audit.id перечитывает old_data и реинсертит boq_item с
        // исходным id (parent_work_item_id-ссылки уцелеют) в одной операции;
        // boq_items-триггер логирует это как новый INSERT-audit.
        try {
          await apiFetch(
            `/api/v1/boq-audit/${encodeURIComponent(record.id)}/rollback`,
            { method: 'POST' },
          );
        } catch (e) {
          const body = (e as { body?: { detail?: string; title?: string } }).body;
          throw new Error(
            body?.detail || body?.title ||
              (e instanceof Error ? e.message : 'Ошибка восстановления'),
          );
        }
      } else {
        const rollbackData = Object.fromEntries(
          Object.entries(record.old_data).filter(([k]) => !['id', 'created_at', 'updated_at'].includes(k))
        );
        await updateBoqItemWithAudit(
          user?.id,
          record.boq_item_id,
          rollbackData as Partial<BoqItemInsert>
        );
      }

      message.success('Версия успешно восстановлена');

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
