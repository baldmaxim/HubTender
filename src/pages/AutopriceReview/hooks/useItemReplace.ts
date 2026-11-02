import { useCallback, useState } from 'react';
import { App } from 'antd';
import { useAuth } from '../../../contexts/AuthContext';
import { deleteBoqItemWithAudit, insertBoqItemWithAudit, updateBoqItemWithAudit } from '../../../lib/api/boq';
import { autopriceErrorMessage } from '../../../lib/api/autoprice';
import type { BoqItemInsert, CurrencyType } from '../../../lib/types';
import { buildMaterialInsert, buildWorkInsert } from '../../PositionItems/utils/boqInsertPayload';
import type { ReplaceChoice } from './useReplaceLibrary';
import type { useRowEditing } from './useRowEditing';

type IRowEditing = ReturnType<typeof useRowEditing>;

/**
 * Замена строки BOQ другой позицией библиотеки того же вида: вставка новой строки с количеством,
 * коэффициентами, порядком и затратой старой → перепривязка материалов → удаление старой.
 * Перепривязка строго до удаления: parent_work_item_id имеет ON DELETE CASCADE.
 * Новая строка ручная: import_session_id не задаётся.
 */
export const useItemReplace = (rowEditing: IRowEditing) => {
  const { message } = App.useApp();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const { items, canEdit, tenderId, currencyRates, gpVolume, markMutated, finishMutation } = rowEditing;

  const replace = useCallback(
    async (oldItemId: string, choice: ReplaceChoice): Promise<boolean> => {
      if (!canEdit) {
        message.warning('Срок редактирования истёк');
        return false;
      }
      const old = items.find((i) => i.id === oldItemId);
      if (!old || !tenderId) {
        message.error('Строка не найдена, обновите панель');
        return false;
      }
      const rateOf = (currency: CurrencyType): number =>
        currency === 'USD' ? currencyRates.usd : currency === 'EUR' ? currencyRates.eur : currency === 'CNY' ? currencyRates.cny : 1;
      const ctx = {
        tenderId,
        positionId: old.client_position_id,
        sortNumber: old.sort_number ?? 0,
      };

      setBusy(true);
      try {
        const built: BoqItemInsert =
          choice.kind === 'work'
            ? buildWorkInsert(choice.lib, { ...ctx, currencyRate: rateOf(choice.lib.currency_type as CurrencyType) })
            : buildMaterialInsert(choice.lib, {
                ...ctx,
                currencyRate: rateOf(choice.lib.currency_type as CurrencyType),
                gpVolume,
              });

        const payload: BoqItemInsert = {
          ...built,
          quantity: old.quantity ?? built.quantity,
          // Старая строка без base_quantity (материал, привязанный к работе) — и у новой его быть не должно.
          base_quantity: old.base_quantity ?? undefined,
          consumption_coefficient: old.consumption_coefficient ?? built.consumption_coefficient,
          conversion_coefficient: old.conversion_coefficient ?? undefined,
          sort_number: old.sort_number ?? built.sort_number,
          detail_cost_category_id: old.detail_cost_category_id ?? undefined,
        };
        if (choice.kind === 'material') {
          payload.material_type = old.material_type ?? built.material_type;
          payload.parent_work_item_id = old.parent_work_item_id ?? undefined;
        }

        markMutated();
        const inserted = await insertBoqItemWithAudit(user?.id, payload);
        const newId = inserted.data.id;

        if (choice.kind === 'work') {
          for (const child of items.filter((i) => i.parent_work_item_id === old.id)) {
            markMutated();
            await updateBoqItemWithAudit(user?.id, child.id, { parent_work_item_id: newId });
          }
        }

        markMutated();
        await deleteBoqItemWithAudit(user?.id, old.id);
        message.success('Строка заменена');
        await finishMutation();
        return true;
      } catch (error) {
        message.error(autopriceErrorMessage(error));
        await finishMutation();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [canEdit, items, tenderId, currencyRates, gpVolume, markMutated, finishMutation, user?.id, message],
  );

  return { replace, busy };
};
