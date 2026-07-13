import { useState } from 'react';
import { message } from 'antd';
import { apiFetch } from '../../../lib/api/client';
import type { BoqItemAudit } from '../../../types/audit';

interface UseAuditRollbackReturn {
  rollback: (record: BoqItemAudit) => Promise<void>;
  rolling: boolean;
}

// Тело RFC 7807 problem+json от Go BFF (code — машиночитаемый идентификатор).
interface ProblemBody {
  detail?: string;
  title?: string;
  code?: string;
}

/**
 * Хук для восстановления BOQ item к предыдущей версии из audit log.
 *
 * Этап 0.1.2.2b: клиент передаёт ТОЛЬКО audit id. Сервер сам перечитывает
 * old_data из boq_items_audit, восстанавливает исключительно пользовательские
 * входы (explicit allowlist) и в той же транзакции пересчитывает total_amount,
 * итоги позиции, commercial-стоимости и grand total по ТЕКУЩИМ курсам и
 * конфигурации тендера. Snapshot (old_data/total_amount/commercial) с клиента
 * не отправляется никогда.
 */
export function useAuditRollback(): UseAuditRollbackReturn {
  const [rolling, setRolling] = useState(false);

  const rollback = async (record: BoqItemAudit) => {
    if (!record.old_data) {
      message.error('Невозможно восстановить: нет данных предыдущей версии');
      return;
    }

    setRolling(true);

    try {
      try {
        await apiFetch(
          `/api/v1/boq-audit/${encodeURIComponent(record.id)}/rollback`,
          { method: 'POST' },
        );
      } catch (e) {
        const body = (e as { body?: ProblemBody }).body;
        const codeSuffix = body?.code ? ` [${body.code}]` : '';
        throw new Error(
          (body?.detail || body?.title ||
            (e instanceof Error ? e.message : 'Ошибка восстановления')) + codeSuffix,
        );
      }

      // Успех показываем только после ответа backend (rollback + пересчёт
      // закоммичены атомарно на сервере).
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
