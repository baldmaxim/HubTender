/**
 * Хук для действий на странице коммерции
 */

import { message, Modal } from 'antd';
import { supabase } from '../../../lib/supabase';
import { applyTacticToTender } from '../../../services/markupTacticService';
import { initializeTestMarkup } from '../../../utils/initializeTestMarkup';

export function useCommerceActions(
  selectedTenderId: string | undefined,
  selectedTacticId: string | undefined,
  boqItems: NonNullable<Parameters<typeof applyTacticToTender>[2]> | null,
  setCalculating: (val: boolean) => void,
  setTacticChanged: (val: boolean) => void,
  syncTenderMarkupTactic: (tenderId: string, tacticId: string) => void,
  loadTenders: () => Promise<void>,
  loadPositions: (tenderId: string) => Promise<void>
) {
  const handleRecalculate = async () => {
    if (!selectedTenderId) {
      message.warning('Выберите тендер для пересчета');
      return;
    }

    setCalculating(true);
    try {
      const result = await applyTacticToTender(selectedTenderId, selectedTacticId, boqItems || undefined);

      if (result.success) {
        message.success(`Пересчитано элементов: ${result.updatedCount}`);
        // Перезагружаем позиции после пересчета
        await loadPositions(selectedTenderId);
      } else {
        message.error('Ошибка при пересчете: ' + (result.errors?.join(', ') || 'Неизвестная ошибка'));
      }
    } catch (error) {
      console.error('Ошибка пересчета:', error);
      message.error('Не удалось выполнить пересчет');
    } finally {
      setCalculating(false);
    }
  };

  const handleInitializeTestData = async () => {
    if (!selectedTenderId) {
      message.warning('Выберите тендер для инициализации');
      return;
    }

    try {
      const tacticId = await initializeTestMarkup(selectedTenderId);
      if (tacticId) {
        message.success('Тестовые данные инициализированы');
        // Перезагружаем тендеры и позиции
        await Promise.all([
          loadTenders(),
          loadPositions(selectedTenderId),
        ]);
      }
    } catch (error) {
      console.error('Ошибка инициализации:', error);
      message.error('Не удалось инициализировать тестовые данные');
    }
  };

  const handleApplyTactic = async () => {
    if (!selectedTenderId || !selectedTacticId) {
      message.warning('Выберите тендер и тактику');
      return;
    }

    Modal.confirm({
      title: 'Применить новую тактику?',
      content: 'Это действие изменит тактику наценок для тендера, пересчитает все коммерческие стоимости и перезапишет существующие расчеты.',
      okText: 'Применить',
      cancelText: 'Отмена',
      onOk: async () => {
        setCalculating(true);
        try {
          // Обновляем тактику в тендере
          const { error: updateError } = await supabase
            .from('tenders')
            .update({ markup_tactic_id: selectedTacticId })
            .eq('id', selectedTenderId);

          if (updateError) throw updateError;

          syncTenderMarkupTactic(selectedTenderId, selectedTacticId);

          // Пересчитываем с новой тактикой
          const result = await applyTacticToTender(selectedTenderId, selectedTacticId, boqItems || undefined);

          if (result.success) {
            message.success('Тактика применена и выполнен пересчет');
            setTacticChanged(false);
            await loadPositions(selectedTenderId);
          } else {
            message.error('Ошибка при пересчете: ' + (result.errors?.join(', ') || 'Неизвестная ошибка'));
          }
        } catch (error) {
          console.error('Ошибка применения тактики:', error);
          message.error('Не удалось применить тактику');
        } finally {
          setCalculating(false);
        }
      }
    });
  };

  return {
    handleRecalculate,
    handleInitializeTestData,
    handleApplyTactic
  };
}
