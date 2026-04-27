import { useState, useCallback } from 'react';
import type { Tender } from '../../../lib/supabase';
import { fetchTenders } from '../../../lib/api/tenders';
import { createSystemNotification } from '../../../lib/api/notifications';
import { getErrorMessage } from '../../../utils/errors';

const addNotification = async (
  title: string,
  message: string,
  type: 'success' | 'info' | 'warning' | 'pending' = 'warning',
) => {
  try {
    await createSystemNotification({ title, message, type });
  } catch (error) {
    console.error('Ошибка создания уведомления:', error);
  }
};

export const useTendersData = () => {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTenders = useCallback(async () => {
    setLoading(true);
    try {
      const tendersData = await fetchTenders();
      setTenders(tendersData);
    } catch (error) {
      await addNotification(
        'Ошибка загрузки списка тендеров',
        `Не удалось загрузить список тендеров: ${getErrorMessage(error)}`,
        'warning',
      );
      console.error('Ошибка загрузки тендеров:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    tenders,
    loading,
    loadTenders,
  };
};
