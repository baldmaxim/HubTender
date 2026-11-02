import { useCallback, useMemo } from 'react';
import { App } from 'antd';
import { useAuth } from '../../../contexts/AuthContext';
import { useDeadlineCheck } from '../../../hooks/useDeadlineCheck';
import { recomputeLinkedMaterials, updateBoqItemWithAudit } from '../../../lib/api/boq';
import { recomputePositionTotals } from '../../../lib/api/positions';
import { markRealtimeMutation } from '../../../lib/realtime/useRealtimeRefetch';
import type { BoqItemFull, BoqItemInsert } from '../../../lib/types';
import { getErrorMessage } from '../../../utils/errors';
import { useBoqItems } from '../../PositionItems/hooks/useBoqItems';
import {
  buildFieldPatch,
  isWorkItemType,
  type BoqItemFieldPatch,
  type EditableFieldKey,
  type FieldPatchCtx,
} from '../../PositionItems/utils/boqFieldPatch';

interface IUseRowEditingParams {
  positionId: string | null;
  tenderId: string | null;
  /** Строка сохранена: панель перезагружает деталь и список. */
  onSaved: () => Promise<void> | void;
}

/**
 * Правка строк BOQ из панели позиции: прямо в таблице (`saveField`) и через лист BoqItemSheet.
 * Строки, единицы и курсы грузятся сразу при открытии позиции; справочники наименований и
 * затрат (нужны только листу) — лениво, при вызове `activate`.
 */
export const useRowEditing = ({ positionId, tenderId, onSaved }: IUseRowEditingParams) => {
  const { message } = App.useApp();
  const { user } = useAuth();
  const activeId = positionId ?? undefined;

  const boq = useBoqItems(activeId, true);
  const { canEdit: canEditByDeadline, loading: deadlineLoading } = useDeadlineCheck(tenderId ?? undefined);
  const { fetchItems, loadEditData } = boq;

  // Пока грузятся строки новой позиции, в state ещё лежат строки прошлой — отбрасываем их.
  const items = useMemo(
    () => (activeId ? boq.items.filter((i) => i.client_position_id === activeId) : []),
    [boq.items, activeId],
  );

  const activate = useCallback(() => {
    void loadEditData();
  }, [loadEditData]);

  const getFull = (itemId: string): BoqItemFull | undefined => items.find((i) => i.id === itemId);

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

  /**
   * Сохранение одного поля из ячейки таблицы. ctx строится как в BoqItemSheet
   * (работы позиции, наличие привязанных материалов), патч — buildFieldPatch.
   * Ошибка (валидация или PATCH) пробрасывается вызывающему — ячейка откатывается.
   */
  const saveField = async (itemId: string, key: EditableFieldKey, draft: unknown): Promise<void> => {
    const item = getFull(itemId);
    if (!item) throw new Error('Строка не найдена, обновите панель');
    const ctx: FieldPatchCtx = {
      item,
      workItems: items.filter((i) => isWorkItemType(i.boq_item_type)),
      units: boq.units,
      gpVolume: boq.gpVolume,
      hasChildren: items.some((i) => i.parent_work_item_id === item.id),
      currencyRates: boq.currencyRates,
    };
    const built = buildFieldPatch(key, draft, ctx);
    if (!built.ok) throw new Error(built.error);
    await onFieldSave(itemId, built.patch, { recomputeWorkId: built.recomputeWorkId });
  };

  const mutationTopic = tenderId ?? boq.position?.tender_id ?? null;

  /** Помечает топик тендера перед записью, чтобы не обрабатывать эхо собственной мутации. */
  const markMutated = (): void => {
    if (mutationTopic) markRealtimeMutation(`tender:${mutationTopic}`);
  };

  /** После вставки/удаления строк: перечитать строки, пересчитать итоги позиции, обновить панель. */
  const finishMutation = async (): Promise<void> => {
    await fetchItems();
    if (positionId) {
      try {
        await recomputePositionTotals(positionId, mutationTopic);
      } catch (error) {
        console.error('Ошибка обновления итогов позиции:', getErrorMessage(error));
      }
    }
    await onSaved();
  };

  return {
    tenderId: mutationTopic,
    markMutated,
    finishMutation,
    ready: items.length > 0,
    getFull,
    saveField,
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
