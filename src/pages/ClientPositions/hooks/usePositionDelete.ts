import { useState } from 'react';
import { message, Modal } from 'antd';
import type { ClientPosition } from '../../../lib/supabase';
import { bulkDeletePositions } from '../../../lib/api/positions';
import { pluralize } from '../../../utils/pluralize';
import { collectSectionDescendants } from '../../../utils/positions/collectSectionDescendants';

interface ClearModesCallback {
  clearOtherModes: () => void;
}

export const usePositionDelete = (
  clientPositions: ClientPosition[],
  setLoading: (loading: boolean) => void,
  fetchClientPositions: (tenderId: string) => Promise<void>,
  applyLocalPositionRemove: (positionIds: string[]) => void,
  currentTheme: string,
  callbacks: ClearModesCallback,
  readOnly?: boolean,
) => {
  const [isPositionDeleteMode, setIsPositionDeleteMode] = useState(false);
  const [selectedPositionDeleteIds, setSelectedPositionDeleteIds] = useState<Set<string>>(new Set());
  const [isBulkPositionDeleting, setIsBulkPositionDeleting] = useState(false);

  const blockedByDeadline = (): boolean => {
    if (readOnly) {
      message.warning('Срок редактирования истёк');
      return true;
    }
    return false;
  };

  // Вход в режим массового удаления строк заказчика
  const handleStartPositionDeleteSelection = (positionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (blockedByDeadline()) return;
    callbacks.clearOtherModes();
    setIsPositionDeleteMode(true);
    // Раздел + все подчинённые строки (как в фильтре)
    setSelectedPositionDeleteIds(collectSectionDescendants(clientPositions, positionId));
  };

  // Toggle выбора строки для массового удаления позиций (иерархически — как фильтр)
  const handleTogglePositionDeleteSelection = (positionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const idsToToggle = collectSectionDescendants(clientPositions, positionId);
    if (idsToToggle.size === 0) return;
    setSelectedPositionDeleteIds(prev => {
      const newSet = new Set(prev);
      const isSelected = newSet.has(positionId);
      for (const id of idsToToggle) {
        if (isSelected) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
      }
      return newSet;
    });
  };

  // Отмена режима массового удаления позиций
  const handleCancelPositionDeleteSelection = () => {
    setIsPositionDeleteMode(false);
    setSelectedPositionDeleteIds(new Set());
  };

  // Массовое удаление строк заказчика (с работами и материалами)
  const handleBulkDeletePositions = async (selectedTenderId: string | null) => {
    if (blockedByDeadline()) return;
    if (selectedPositionDeleteIds.size === 0) return;

    const count = selectedPositionDeleteIds.size;

    Modal.confirm({
      title: 'Удалить строки заказчика?',
      content: `Вы уверены, что хотите удалить ${count} ${pluralize(count, 'строку', 'строки', 'строк')} заказчика? Все связанные работы и материалы также будут удалены. Это действие нельзя отменить.`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: currentTheme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        setIsBulkPositionDeleting(true);
        const positionIds = Array.from(selectedPositionDeleteIds);
        try {
          // Go: одна транзакция (delete boq_items → delete client_positions).
          await bulkDeletePositions(positionIds, selectedTenderId);

          // Сброс режима + оптимистичное локальное удаление строк (без рефетча).
          setSelectedPositionDeleteIds(new Set());
          setIsPositionDeleteMode(false);
          applyLocalPositionRemove(positionIds);

          message.success(
            `Удалено ${count} ${pluralize(count, 'строка', 'строки', 'строк')} заказчика`
          );
        } catch (error) {
          console.error('Ошибка удаления строк заказчика:', error);
          message.error('Ошибка удаления: ' + (error instanceof Error ? error.message : String(error)));
          if (selectedTenderId) await fetchClientPositions(selectedTenderId); // resync
        } finally {
          setIsBulkPositionDeleting(false);
        }
      },
    });
  };

  return {
    isPositionDeleteMode,
    selectedPositionDeleteIds,
    isBulkPositionDeleting,
    handleStartPositionDeleteSelection,
    handleTogglePositionDeleteSelection,
    handleCancelPositionDeleteSelection,
    handleBulkDeletePositions,
  };
};
