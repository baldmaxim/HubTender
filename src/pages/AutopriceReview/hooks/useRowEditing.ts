import { useCallback, useMemo, useState } from 'react';
import { App } from 'antd';
import { useAuth } from '../../../contexts/AuthContext';
import { useDeadlineCheck } from '../../../hooks/useDeadlineCheck';
import { recomputeLinkedMaterials, updateBoqItemWithAudit } from '../../../lib/api/boq';
import { recomputePositionTotals } from '../../../lib/api/positions';
import { markRealtimeMutation } from '../../../lib/realtime/useRealtimeRefetch';
import type { BoqItemInsert } from '../../../lib/types';
import { getErrorMessage } from '../../../utils/errors';
import { useBoqItems } from '../../PositionItems/hooks/useBoqItems';
import type { BoqItemFieldPatch } from '../../PositionItems/utils/boqFieldPatch';

interface IUseRowEditingParams {
  positionId: string | null;
  tenderId: string | null;
  /** Строка сохранена: панель перезагружает деталь и список. */
  onSaved: () => Promise<void> | void;
}

/**
 * Правка строк BOQ из панели позиции (лист BoqItemSheet).
 * Данные позиции и справочники грузятся лениво — при первом вызове `activate`;
 * при смене позиции загруженное сбрасывается (строки фильтруются по позиции).
 */
export const useRowEditing = ({ positionId, tenderId, onSaved }: IUseRowEditingParams) => {
  const { message } = App.useApp();
  const { user } = useAuth();
  const [activatedFor, setActivatedFor] = useState<string | null>(null);
  const activeId = positionId && activatedFor === positionId ? positionId : undefined;

  const boq = useBoqItems(activeId, true);
  const { canEdit: canEditByDeadline, loading: deadlineLoading } = useDeadlineCheck(tenderId ?? undefined);
  const { fetchItems, loadEditData } = boq;

  // Пока грузятся строки новой позиции, в state ещё лежат строки прошлой — отбрасываем их.
  const items = useMemo(
    () => (activeId ? boq.items.filter((i) => i.client_position_id === activeId) : []),
    [boq.items, activeId],
  );

  const activate = useCallback(() => {
    if (positionId) setActivatedFor(positionId);
    void loadEditData();
  }, [positionId, loadEditData]);

  // Повторяет handleItemFieldSave из PositionItems/hooks/useItemActions.ts.
  // Ошибку PATCH не глотаем: её ловит лист и оставляет поле в режиме редактирования.
  const onFieldSave = async (
    itemId: string,
    patch: BoqItemFieldPatch,
    opts: { recomputeWorkId?: string } = {},
  ): Promise<void> => {
    if (!positionId) throw new Error('Позиция не выбрана');
    if (!canEditByDeadline || deadlineLoading) throw new Error('Срок редактирования истёк');
    if (Object.keys(patch).length === 0) throw new Error('Нет изменений');

    const topic = tenderId ?? boq.position?.tender_id;
    const markMutated = (): void => {
      if (topic) markRealtimeMutation(`tender:${topic}`);
    };

    markMutated();
    await updateBoqItemWithAudit(user?.id, itemId, patch as Partial<BoqItemInsert>);

    if (opts.recomputeWorkId) {
      markMutated();
      try {
        await recomputeLinkedMaterials(opts.recomputeWorkId);
      } catch (error) {
        // PATCH уже закоммичен — не роняем сохранение целиком.
        message.error('Сохранено, но пересчёт количества материалов не выполнен: ' + getErrorMessage(error));
      }
    }

    await fetchItems();
    try {
      await recomputePositionTotals(positionId, topic ?? null);
    } catch (error) {
      console.error('Ошибка обновления итогов позиции:', getErrorMessage(error));
    }
    await onSaved();
  };

  return {
    items,
    workNames: boq.workNames,
    materialNames: boq.materialNames,
    costCategories: boq.costCategories,
    units: boq.units,
    currencyRates: boq.currencyRates,
    gpVolume: boq.gpVolume,
    editDataState: boq.editDataState,
    canEdit: canEditByDeadline && !deadlineLoading,
    activate,
    onFieldSave,
  };
};
