import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button } from 'antd';
import { patchTenderRegistryFields } from '../../../../lib/api/tenderRegistry';
import type { TenderRegistryWithRelations } from '../../../../lib/types';
import {
  getKanbanColumn,
  getKanbanColumnDef,
  snapshotStatusPatch,
  type KanbanColumnKey,
  type KanbanTarget,
} from '../../utils/tenderKanban';

interface IKanbanOverride {
  column: KanbanColumnKey;
  target: KanbanTarget;
  /** updated_at строки на момент переноса: изменилась — сервер прислал свежие данные. */
  baseUpdatedAt: string;
  saving: boolean;
}

const ERROR_FLASH_MS = 1200;

const applyOverride = (tender: TenderRegistryWithRelations, override?: IKanbanOverride): TenderRegistryWithRelations =>
  override
    ? {
        ...tender,
        status_id: override.target.patch.status_id,
        status: override.target.status,
        dashboard_status: override.target.patch.dashboard_status,
        is_archived: override.target.patch.is_archived,
      }
    : tender;

interface IUseKanbanMoveParams {
  tenders: TenderRegistryWithRelations[];
  onUpdate: () => Promise<void> | void;
}

/**
 * Оптимистичный перенос между колонками: карточка сразу встаёт в новую колонку,
 * запрос идёт в фоне. Ошибка — откат и «встряска» карточки, успех — тост с «Отменить».
 */
export const useKanbanMove = ({ tenders, onUpdate }: IUseKanbanMoveParams) => {
  const { message } = App.useApp();
  const [overrides, setOverrides] = useState<Record<string, IKanbanOverride>>({});
  const [errorIds, setErrorIds] = useState<ReadonlySet<string>>(() => new Set());

  const tendersRef = useRef(tenders);
  tendersRef.current = tenders;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  // Сервер догнал перенос (или строку поменял кто-то ещё) — локальная подмена больше не нужна.
  useEffect(() => {
    setOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([id, override]) => {
        if (override.saving) return;
        const tender = tenders.find((item) => item.id === id);
        if (!tender || tender.updated_at !== override.baseUpdatedAt || getKanbanColumn(tender) === override.column) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [tenders]);

  const effectiveTenders = useMemo(
    () => tenders.map((tender) => applyOverride(tender, overrides[tender.id])),
    [tenders, overrides]
  );

  const flashError = useCallback((id: string) => {
    setErrorIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setErrorIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, ERROR_FLASH_MS);
  }, []);

  const moveTender = useCallback(
    async (id: string, column: KanbanColumnKey, target: KanbanTarget, isUndo = false) => {
      const base = tendersRef.current.find((item) => item.id === id);
      if (!base) return;

      const current = applyOverride(base, overridesRef.current[id]);
      const fromColumn = getKanbanColumn(current);
      if (fromColumn === column) return;
      const undoTarget = snapshotStatusPatch(current, fromColumn);

      setOverrides((prev) => ({
        ...prev,
        [id]: { column, target, baseUpdatedAt: base.updated_at, saving: true },
      }));

      try {
        await patchTenderRegistryFields(id, { ...target.patch });
      } catch {
        setOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        flashError(id);
        message.error(`Не удалось изменить статус «${base.title}». Изменение отменено`);
        return;
      }

      setOverrides((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], saving: false } } : prev));

      const toastKey = `tender-kanban-${id}`;
      if (isUndo) {
        message.info({ key: toastKey, content: 'Перенос отменён' });
      } else {
        message.success({
          key: toastKey,
          duration: 6,
          content: (
            <span>
              Тендер «{base.title}» перенесён в «{getKanbanColumnDef(column).title}»
              <Button
                type="link"
                size="small"
                className="kb-toast-undo"
                onClick={() => {
                  message.destroy(toastKey);
                  void moveTender(id, fromColumn, undoTarget, true);
                }}
              >
                Отменить
              </Button>
            </span>
          ),
        });
      }

      await onUpdate();
    },
    [flashError, message, onUpdate]
  );

  const pendingIds = useMemo(
    () => new Set(Object.entries(overrides).filter(([, item]) => item.saving).map(([id]) => id)),
    [overrides]
  );

  return { effectiveTenders, moveTender, pendingIds, errorIds };
};
