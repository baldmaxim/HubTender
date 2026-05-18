import { useState, useCallback } from 'react';
import { message } from 'antd';
import type { MarkupParameter } from '../../../../lib/supabase';
import {
  listActiveMarkupParameters,
  createMarkupParameter,
  updateMarkupParameter,
  deleteMarkupParameter,
} from '../../../../lib/api/markup';

/**
 * Хук для работы с глобальным справочником параметров наценок
 *
 * ВАЖНО: markup_parameters - это ГЛОБАЛЬНЫЙ справочник параметров,
 * НЕ связанный с конкретными тактиками!
 * Параметры тактик хранятся в JSONB поле sequences внутри markup_tactics.
 */
export const useMarkupParameters = () => {
  const [markupParameters, setMarkupParameters] = useState<MarkupParameter[]>([]);
  const [loadingParameters, setLoadingParameters] = useState(false);
  const [editingParameterId, setEditingParameterId] = useState<string | null>(null);
  const [editingParameterLabel, setEditingParameterLabel] = useState('');

  // Загрузка всех активных параметров из глобального справочника
  const fetchParameters = useCallback(async () => {
    setLoadingParameters(true);
    try {
      const data = await listActiveMarkupParameters();
      setMarkupParameters(data || []);
    } catch (error) {
      console.error('Error fetching parameters:', error);
      message.error('Ошибка загрузки параметров наценок');
    } finally {
      setLoadingParameters(false);
    }
  }, []);

  // Добавление нового параметра в глобальный справочник
  const addParameter = useCallback(async (parameterData: {
    key: string;
    label: string;
    default_value?: number;
  }) => {
    try {
      // Получаем максимальный order_num по актуальному списку с сервера
      const existing = await listActiveMarkupParameters();
      const maxOrder = existing.reduce((m, p) => Math.max(m, p.order_num ?? 0), 0);

      await createMarkupParameter({
        key: parameterData.key,
        label: parameterData.label,
        default_value: parameterData.default_value || 0,
        is_active: true,
        order_num: maxOrder + 1,
      });

      const refreshed = await listActiveMarkupParameters();
      setMarkupParameters(refreshed);

      message.success('Параметр наценки добавлен');
      return refreshed.find(p => p.key === parameterData.key);
    } catch (error) {
      console.error('Error adding parameter:', error);
      message.error('Ошибка добавления параметра наценки');
      throw error;
    }
  }, []);

  // Удаление параметра из глобального справочника
  const deleteParameter = useCallback(async (parameterId: string) => {
    try {
      await deleteMarkupParameter(parameterId);

      message.success('Параметр наценки удален');
      setMarkupParameters(prev => prev.filter(p => p.id !== parameterId));
    } catch (error) {
      console.error('Error deleting parameter:', error);
      message.error('Ошибка удаления параметра наценки');
    }
  }, []);

  // Обновление параметра
  const updateParameter = useCallback(async (
    parameterId: string,
    updates: Partial<MarkupParameter>
  ) => {
    try {
      await updateMarkupParameter(
        parameterId,
        updates as Partial<Pick<MarkupParameter, 'label' | 'default_value' | 'order_num' | 'is_active'>>,
      );

      setMarkupParameters(prev =>
        prev.map(p => (p.id === parameterId ? { ...p, ...updates } : p))
      );
    } catch (error) {
      console.error('Error updating parameter:', error);
      message.error('Ошибка обновления параметра наценки');
      throw error;
    }
  }, []);

  // Изменение порядка параметров
  const reorderParameters = useCallback(async (
    parameterId: string,
    direction: 'up' | 'down'
  ) => {
    const index = markupParameters.findIndex(p => p.id === parameterId);
    if (index === -1) return;

    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === markupParameters.length - 1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const newParameters = [...markupParameters];
    [newParameters[index], newParameters[newIndex]] = [
      newParameters[newIndex],
      newParameters[index],
    ];

    try {
      // Обновляем order_num для обоих параметров
      await Promise.all([
        updateParameter(newParameters[index].id, { order_num: index + 1 }),
        updateParameter(newParameters[newIndex].id, { order_num: newIndex + 1 }),
      ]);

      setMarkupParameters(newParameters);
    } catch (error) {
      console.error('Error reordering parameters:', error);
      message.error('Ошибка изменения порядка параметров');
    }
  }, [markupParameters, updateParameter]);

  // Начало редактирования названия параметра
  const startEditingParameter = useCallback((parameterId: string, label: string) => {
    setEditingParameterId(parameterId);
    setEditingParameterLabel(label);
  }, []);

  // Отмена редактирования
  const cancelEditingParameter = useCallback(() => {
    setEditingParameterId(null);
    setEditingParameterLabel('');
  }, []);

  // Сохранение отредактированного названия
  const saveEditingParameter = useCallback(async () => {
    if (!editingParameterId || !editingParameterLabel.trim()) {
      message.error('Название не может быть пустым');
      return;
    }

    try {
      await updateParameter(editingParameterId, {
        label: editingParameterLabel.trim(),
      });
      message.success('Название параметра обновлено');
      setEditingParameterId(null);
      setEditingParameterLabel('');
    } catch (error) {
      // Error already handled in updateParameter
    }
  }, [editingParameterId, editingParameterLabel, updateParameter]);

  return {
    markupParameters,
    loadingParameters,
    editingParameterId,
    editingParameterLabel,
    setEditingParameterLabel,
    fetchParameters,
    addParameter,
    deleteParameter,
    updateParameter,
    reorderParameters,
    startEditingParameter,
    cancelEditingParameter,
    saveEditingParameter,
  };
};
