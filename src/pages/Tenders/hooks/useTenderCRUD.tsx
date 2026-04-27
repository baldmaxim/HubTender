import { Modal, message } from 'antd';
import type { TenderRegistry, TenderRegistryWithRelations } from '../../../lib/supabase';
import {
  archiveTenderRegistry,
  swapTenderRegistrySortOrder,
} from '../../../lib/api/tenderRegistry';

export const useTenderCRUD = (tenders: TenderRegistryWithRelations[], refetch: () => void) => {
  const handleMoveUp = async (tender: TenderRegistry) => {
    const currentIndex = tenders.findIndex(t => t.id === tender.id);
    if (currentIndex <= 0) return;
    await swapTenderRegistrySortOrder(tender, tenders[currentIndex - 1]);
    refetch();
  };

  const handleMoveDown = async (tender: TenderRegistry) => {
    const currentIndex = tenders.findIndex(t => t.id === tender.id);
    if (currentIndex >= tenders.length - 1) return;
    await swapTenderRegistrySortOrder(tender, tenders[currentIndex + 1]);
    refetch();
  };

  const handleArchive = async (tender: TenderRegistry) => {
    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    Modal.confirm({
      title: 'Архивировать тендер?',
      content: `Вы уверены, что хотите переместить "${tender.title}" в архив?`,
      okText: 'Архивировать',
      cancelText: 'Отмена',
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        try {
          await archiveTenderRegistry(tender.id);
          message.success('Тендер перемещен в архив');
          refetch();
        } catch {
          message.error('Ошибка архивации');
        }
      },
    });
  };

  return { handleMoveUp, handleMoveDown, handleArchive };
};
