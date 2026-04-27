import { useState, useEffect } from 'react';
import { message } from 'antd';
import { getErrorMessage } from '../../../utils/errors';
import {
  listUserPositionFilter,
  clearUserPositionFilter,
  insertUserPositionFilter,
  appendUserPositionFilter,
} from '../../../lib/api/positionFilters';

export const usePositionFilters = (
  userId: string | undefined,
  tenderId: string | null
) => {
  const [selectedPositionIds, setSelectedPositionIds] = useState<Set<string>>(new Set());
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (userId && tenderId) {
      fetchFilter();
    } else {
      setSelectedPositionIds(new Set());
      setIsFilterActive(false);
    }
    // fetchFilter is defined in this hook; intentionally excluded to avoid refetch loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tenderId]);

  const fetchFilter = async () => {
    if (!userId || !tenderId) return;

    setLoading(true);
    try {
      const ids = await listUserPositionFilter(userId, tenderId);
      const positionIds = new Set(ids);
      setSelectedPositionIds(positionIds);
      setIsFilterActive(positionIds.size > 0);
    } catch (error) {
      message.error('Ошибка загрузки фильтра: ' + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const saveFilter = async (positionIds: string[]) => {
    if (!userId || !tenderId) return;

    setLoading(true);
    try {
      await clearUserPositionFilter(userId, tenderId);
      await insertUserPositionFilter(userId, tenderId, positionIds);

      setSelectedPositionIds(new Set(positionIds));
      setIsFilterActive(positionIds.length > 0);
      message.success('Фильтр сохранен');
    } catch (error) {
      message.error('Ошибка сохранения фильтра: ' + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const addPositionToFilter = async (positionId: string) => {
    if (!userId || !tenderId) return;
    try {
      await appendUserPositionFilter(userId, tenderId, positionId);
      setSelectedPositionIds((prev) => new Set([...prev, positionId]));
    } catch (error) {
      message.error('Ошибка добавления позиции в фильтр: ' + getErrorMessage(error));
    }
  };

  const clearFilter = async () => {
    if (!userId || !tenderId) return;

    setLoading(true);
    try {
      await clearUserPositionFilter(userId, tenderId);
      setSelectedPositionIds(new Set());
      setIsFilterActive(false);
      message.success('Фильтр отключен');
    } catch (error) {
      message.error('Ошибка очистки фильтра: ' + getErrorMessage(error));
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
