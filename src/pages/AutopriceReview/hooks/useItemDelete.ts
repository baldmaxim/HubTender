import { useCallback } from 'react';
import { App } from 'antd';
import { useAuth } from '../../../contexts/AuthContext';
import { deleteBoqItemWithAudit } from '../../../lib/api/boq';
import { autopriceErrorMessage } from '../../../lib/api/autoprice';
import type { useRowEditing } from './useRowEditing';

type IRowEditing = ReturnType<typeof useRowEditing>;

/** Удаление строки BOQ из панели (как handleDelete на странице позиции). Привязанные материалы удаляются каскадом. */
export const useItemDelete = (rowEditing: IRowEditing) => {
  const { message } = App.useApp();
  const { user } = useAuth();
  const { canEdit, markMutated, finishMutation } = rowEditing;

  return useCallback(
    async (itemId: string): Promise<void> => {
      if (!canEdit) {
        message.warning('Срок редактирования истёк');
        return;
      }
      try {
        markMutated();
        await deleteBoqItemWithAudit(user?.id, itemId);
        message.success('Строка удалена');
      } catch (error) {
        message.error('Ошибка удаления: ' + autopriceErrorMessage(error));
      }
      // Перечитываем и после ошибки: строка могла уже исчезнуть.
      await finishMutation();
    },
    [canEdit, markMutated, finishMutation, user?.id, message],
  );
};
