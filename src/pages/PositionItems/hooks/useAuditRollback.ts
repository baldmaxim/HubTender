import { useState } from 'react';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
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
    if (!record.old_data) {
      message.error('Невозможно восстановить: нет данных предыдущей версии');
      return;
    }

    setRolling(true);

    try {
      if (record.operation_type === 'DELETE') {
        // Re-insert с тем же id, чтобы parent_work_item_id-ссылки уцелели.
        // created_at/updated_at сбрасываем — пусть default'ы выставят свежие.
        const old = record.old_data as unknown as Record<string, unknown>;
        const { created_at: _ca, updated_at: _ua, ...payload } = old;
        void _ca; void _ua;
        const { error } = await supabase.from('boq_items').insert(payload as unknown as BoqItemInsert);
        if (error) {
          if (error.code === '23503') {
            throw new Error('Не удалось восстановить: позиция или тендер удалены');
          }
          if (error.code === '23505') {
            throw new Error('Элемент с таким id уже существует');
          }
          throw error;
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
