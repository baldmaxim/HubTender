import { useState } from 'react';
import { message, Modal } from 'antd';
import { supabase } from '../../../lib/supabase';
import { pluralize } from '../../../utils/pluralize';

interface ClearModesCallback {
  clearOtherModes: () => void;
}

export const usePositionDelete = (
  setLoading: (loading: boolean) => void,
  fetchClientPositions: (tenderId: string) => Promise<void>,
  currentTheme: string,
  callbacks: ClearModesCallback
) => {
  const [isPositionDeleteMode, setIsPositionDeleteMode] = useState(false);
  const [selectedPositionDeleteIds, setSelectedPositionDeleteIds] = useState<Set<string>>(new Set());
  const [isBulkPositionDeleting, setIsBulkPositionDeleting] = useState(false);

  // Вход в режим массового удаления строк заказчика
  const handleStartPositionDeleteSelection = (positionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    callbacks.clearOtherModes();
    setIsPositionDeleteMode(true);
    setSelectedPositionDeleteIds(new Set([positionId]));
  };

  // Toggle выбора строки для массового удаления позиций
  const handleTogglePositionDeleteSelection = (positionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedPositionDeleteIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(positionId)) {
        newSet.delete(positionId);
      } else {
        newSet.add(positionId);
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
        setLoading(true);
        try {
          const positionIds = Array.from(selectedPositionDeleteIds);
          const batchSize = 100;

          // 1. Удалить boq_items батчами
          for (let i = 0; i < positionIds.length; i += batchSize) {
            const batch = positionIds.slice(i, i + batchSize);
            const { error } = await supabase
              .from('boq_items')
              .delete()
              .in('client_position_id', batch);
            if (error) throw error;
          }

          // 2. Удалить сами позиции батчами
          for (let i = 0; i < positionIds.length; i += batchSize) {
            const batch = positionIds.slice(i, i + batchSize);
            const { error } = await supabase
              .from('client_positions')
              .delete()
              .in('id', batch);
            if (error) throw error;
          }

          // 3. Сброс состояния и обновление таблицы
          setSelectedPositionDeleteIds(new Set());
          setIsPositionDeleteMode(false);

          if (selectedTenderId) {
            await fetchClientPositions(selectedTenderId);
          }

          message.success(
            `Удалено ${count} ${pluralize(count, 'строка', 'строки', 'строк')} заказчика`
          );
        } catch (error) {
          console.error('Ошибка удаления строк заказчика:', error);
          message.error('Ошибка удаления: ' + (error instanceof Error ? error.message : String(error)));
        } finally {
          setIsBulkPositionDeleting(false);
          setLoading(false);
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
