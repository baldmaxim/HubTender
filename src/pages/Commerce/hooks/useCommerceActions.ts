/**
 * Хук для действий на странице коммерции
 */

import { message, Modal } from 'antd';
import { initializeTestMarkup } from '../../../utils/initializeTestMarkup';
import { setTenderMarkupTacticId } from '../../../lib/api/markup';

export function useCommerceActions(
  selectedTenderId: string | undefined,
  selectedTacticId: string | undefined,
  setCalculating: (val: boolean) => void,
  setTacticChanged: (val: boolean) => void,
  syncTenderMarkupTactic: (tenderId: string, tacticId: string) => void,
  loadTenders: () => Promise<void>,
  loadPositions: (tenderId: string) => Promise<void>
) {
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
      content:
        'Тактика наценок тендера будет изменена. Коммерческие стоимости пересчитаются автоматически на сервере.',
      okText: 'Применить',
      cancelText: 'Отмена',
      onOk: async () => {
        setCalculating(true);
        try {
          // Меняем тактику тендера — серверный авто-пересчёт (Go BFF) сам
          // материализует коммерческие стоимости и grand-total; никакого
          // клиентского bulk-обновления больше нет.
          await setTenderMarkupTacticId(selectedTenderId, selectedTacticId);
          syncTenderMarkupTactic(selectedTenderId, selectedTacticId);
          setTacticChanged(false);
          message.success('Тактика применена, выполняется автоматический пересчёт');
          // Локальное отображение считается на лету по выбранной тактике;
          // материализованные значения подтянутся через realtime после пересчёта.
          await loadPositions(selectedTenderId);
        } catch (error) {
          console.error('Ошибка применения тактики:', error);
          message.error('Не удалось применить тактику');
        } finally {
          setCalculating(false);
        }
      },
    });
  };

  return {
    handleInitializeTestData,
    handleApplyTactic,
  };
}
