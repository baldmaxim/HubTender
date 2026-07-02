import { Modal, message } from 'antd';
import type { BoqItemFull } from '../../../lib/types';
import { clearPositionsBoq } from '../../../lib/api/positions';
import { deleteBoqItemWithAudit, updateBoqItemWithAudit } from '../../../lib/api/boq';
import { getErrorMessage } from '../../../utils/errors';

interface CostCategoryOption {
  value: string;
  label: string;
}

interface UseItemBulkActionsArgs {
  positionId?: string;
  items: BoqItemFull[];
  userId?: string;
  fetchItems: () => Promise<void>;
  costCategories: CostCategoryOption[];
  costSearchText: string;
  selectedCostCategoryId: string | null;
  setSelectedCostCategoryId: (v: string | null) => void;
  setCostSearchText: (v: string) => void;
  selectedDeleteIds: Set<string>;
  setIsDeleteMode: (v: boolean) => void;
  setSelectedDeleteIds: (v: Set<string>) => void;
  setIsBulkDeleting: (v: boolean) => void;
}

const plural = (n: number) => (n === 1 ? '' : n < 5 ? 'а' : 'ов');
const darkClass = () => (localStorage.getItem('tenderHub_theme') === 'dark' ? 'dark-modal' : '');

/** Массовые действия над элементами позиции (удаление/очистка/распространение затраты). */
export function useItemBulkActions({
  positionId,
  items,
  userId,
  fetchItems,
  costCategories,
  costSearchText,
  selectedCostCategoryId,
  setSelectedCostCategoryId,
  setCostSearchText,
  selectedDeleteIds,
  setIsDeleteMode,
  setSelectedDeleteIds,
  setIsBulkDeleting,
}: UseItemBulkActionsArgs) {
  const handleBulkDelete = async () => {
    if (selectedDeleteIds.size === 0) return;
    const count = selectedDeleteIds.size;

    Modal.confirm({
      title: 'Удалить элементы?',
      content: `Вы уверены, что хотите удалить ${count} выбранных элемент${plural(count)}? Это действие необратимо.`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: darkClass(),
      onOk: async () => {
        setIsBulkDeleting(true);
        try {
          for (const id of selectedDeleteIds) {
            await deleteBoqItemWithAudit(userId, id);
          }
          setIsDeleteMode(false);
          setSelectedDeleteIds(new Set());
          await fetchItems();
          message.success(`Удалено ${count} элемент${plural(count)}`);
        } catch (error) {
          message.error('Ошибка удаления: ' + getErrorMessage(error));
        } finally {
          setIsBulkDeleting(false);
        }
      },
    });
  };

  const handleClearAllItems = async () => {
    Modal.confirm({
      title: 'Очистить все элементы?',
      content: 'Вы действительно хотите удалить все работы и материалы из этой позиции? Это действие необратимо.',
      okText: 'Да, очистить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: darkClass(),
      onOk: async () => {
        try {
          for (const item of items) {
            await deleteBoqItemWithAudit(userId, item.id);
          }
          if (positionId) {
            // delete уже выполнен с аудитом выше; здесь только обнуляем итоги позиции.
            await clearPositionsBoq([positionId]);
          }
          await fetchItems();
          message.success('Все элементы успешно удалены');
        } catch (error) {
          message.error('Ошибка при удалении элементов: ' + getErrorMessage(error));
        }
      },
    });
  };

  const handleApplyCostToAll = async () => {
    if (!selectedCostCategoryId) {
      message.error('Выберите затрату на строительство');
      return;
    }
    if (items.length === 0) {
      message.warning('Нет элементов для применения затраты');
      return;
    }

    Modal.confirm({
      title: 'Распространить затрату на все строки?',
      content: `Выбранная затрата будет применена ко всем ${items.length} элементам (работы и материалы). Продолжить?`,
      okText: 'Да, применить',
      cancelText: 'Отмена',
      rootClassName: darkClass(),
      onOk: async () => {
        try {
          for (const item of items) {
            await updateBoqItemWithAudit(userId, item.id, {
              detail_cost_category_id: selectedCostCategoryId,
            });
          }
          await fetchItems();
          message.success(`Затрата успешно применена к ${items.length} элементам`);
          setSelectedCostCategoryId(null);
          setCostSearchText('');
        } catch (error) {
          message.error('Ошибка при применении затраты: ' + getErrorMessage(error));
        }
      },
    });
  };

  const getCostCategoryOptions = () =>
    costCategories
      .filter((c) => c.label.toLowerCase().includes(costSearchText.toLowerCase()))
      .map((c) => ({ value: c.label, id: c.value, label: c.label }));

  return { handleBulkDelete, handleClearAllItems, handleApplyCostToAll, getCostCategoryOptions };
}
