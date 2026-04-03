import { useState, useEffect } from 'react';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';

export const usePositionFilters = (
  userId: string | undefined,
  tenderId: string | null
) => {
  const [selectedPositionIds, setSelectedPositionIds] = useState<Set<string>>(new Set());
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [loading, setLoading] = useState(false);

  // Загрузка фильтра из БД при монтировании или смене тендера
  useEffect(() => {
    if (userId && tenderId) {
      fetchFilter();
    } else {
      // Сброс при выходе из тендера
      setSelectedPositionIds(new Set());
      setIsFilterActive(false);
    }
  }, [userId, tenderId]);

  // Загрузка фильтра из БД
  const fetchFilter = async () => {
    if (!userId || !tenderId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_position_filters')
        .select('position_id')
        .eq('user_id', userId)
        .eq('tender_id', tenderId);

      if (error) throw error;

      const positionIds = new Set((data || []).map(item => item.position_id));
      setSelectedPositionIds(positionIds);
      setIsFilterActive(positionIds.size > 0);
    } catch (error: any) {
      message.error('Ошибка загрузки фильтра: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Сохранение фильтра в БД
  const saveFilter = async (positionIds: string[]) => {
    if (!userId || !tenderId) return;

    setLoading(true);
    try {
      // 1. Удалить все существующие записи фильтра
      const { error: deleteError } = await supabase
        .from('user_position_filters')
        .delete()
        .eq('user_id', userId)
        .eq('tender_id', tenderId);

      if (deleteError) throw deleteError;

      // 2. Вставить новые записи (если есть)
      if (positionIds.length > 0) {
        const records = positionIds.map(positionId => ({
          user_id: userId,
          tender_id: tenderId,
          position_id: positionId,
        }));

        // Батчинг для больших списков (по 100 записей)
        const batchSize = 100;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          const { error: insertError } = await supabase
            .from('user_position_filters')
            .insert(batch);

          if (insertError) throw insertError;
        }
      }

      setSelectedPositionIds(new Set(positionIds));
      setIsFilterActive(positionIds.length > 0);
      message.success('Фильтр сохранен');
    } catch (error: any) {
      message.error('Ошибка сохранения фильтра: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Добавление одной позиции в активный фильтр (например, новая ДОП работа)
  const addPositionToFilter = async (positionId: string) => {
    if (!userId || !tenderId) return;
    try {
      await supabase.from('user_position_filters').insert({
        user_id: userId,
        tender_id: tenderId,
        position_id: positionId,
      });
      setSelectedPositionIds(prev => new Set([...prev, positionId]));
    } catch (error: any) {
      message.error('Ошибка добавления позиции в фильтр: ' + error.message);
    }
  };

  // Очистка фильтра
  const clearFilter = async () => {
    if (!userId || !tenderId) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('user_position_filters')
        .delete()
        .eq('user_id', userId)
        .eq('tender_id', tenderId);

      if (error) throw error;

      setSelectedPositionIds(new Set());
      setIsFilterActive(false);
      message.success('Фильтр отключен');
    } catch (error: any) {
      message.error('Ошибка очистки фильтра: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return {
    selectedPositionIds,
    isFilterActive,
    loading,
    saveFilter,
    clearFilter,
    addPositionToFilter,
  };
};
