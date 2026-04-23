import { useState, useCallback } from 'react';
import { message } from 'antd';
import { supabase, MarkupTactic } from '../../../../lib/supabase';

export const useMarkupTactics = () => {
  const [tactics, setTactics] = useState<MarkupTactic[]>([]);
  const [loadingTactics, setLoadingTactics] = useState(false);
  const [selectedTacticId, setSelectedTacticId] = useState<string | null>(null);
  const [currentTacticId, setCurrentTacticId] = useState<string | null>(null);
  const [currentTacticName, setCurrentTacticName] = useState<string>('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [tacticSearchText, setTacticSearchText] = useState('');

  const fetchTactics = useCallback(async () => {
    setLoadingTactics(true);
    try {
      // Загружаем все тактики (глобальные и пользовательские)
      const { data, error } = await supabase
        .from('markup_tactics')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTactics(data || []);
    } catch (error) {
      console.error('Error fetching tactics:', error);
      message.error('Ошибка загрузки схем наценок');
    } finally {
      setLoadingTactics(false);
    }
  }, []);

  const createNewTactic = useCallback(async (
    tenderId: string | null,
    name: string,
    onSuccess?: (tacticId: string) => void
  ) => {
    try {
      const { data, error} = await supabase
        .from('markup_tactics')
        .insert({
          name: name,
          is_global: false,
        })
        .select()
        .single();

      if (error) throw error;

      message.success('Схема наценок создана');
      setTactics(prev => [data, ...prev]);

      if (onSuccess) {
        onSuccess(data.id);
      }

      return data;
    } catch (error) {
      console.error('Error creating tactic:', error);
      message.error('Ошибка создания схемы наценок');
    }
  }, []);

  const copyTactic = useCallback(async (
    tacticId: string,
    tenderId: string | null,
    onSuccess?: (newTacticId: string) => void
  ) => {
    if (!tenderId) {
      message.error('Не выбран тендер');
      return;
    }

    try {
      // Получаем исходную тактику с параметрами
      const { data: sourceTactic, error: tacticError } = await supabase
        .from('markup_tactics')
        .select('*, markup_parameters(*)')
        .eq('id', tacticId)
        .single();

      if (tacticError) throw tacticError;

      // Создаем копию тактики
      const { data: newTactic, error: insertError } = await supabase
        .from('markup_tactics')
        .insert({
          tender_id: tenderId,
          tactic_name: `${sourceTactic.tactic_name} (копия)`,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Копируем параметры
      if (sourceTactic.markup_parameters && sourceTactic.markup_parameters.length > 0) {
        const newParameters = sourceTactic.markup_parameters.map((param: any) => ({
          tactic_id: newTactic.id,
          parameter_name: param.parameter_name,
          base_value: param.base_value,
          coefficient: param.coefficient,
          is_percentage: param.is_percentage,
          order_number: param.order_number,
        }));

        const { error: paramsError } = await supabase
          .from('markup_parameters')
          .insert(newParameters);

        if (paramsError) throw paramsError;
      }

      message.success('Схема наценок скопирована');
      await fetchTactics();

      if (onSuccess) {
        onSuccess(newTactic.id);
      }

      return newTactic;
    } catch (error) {
      console.error('Error copying tactic:', error);
      message.error('Ошибка копирования схемы наценок');
    }
  }, [fetchTactics]);

  const deleteTactic = useCallback(async (tacticId: string) => {
    try {
      const { error } = await supabase
        .from('markup_tactics')
        .delete()
        .eq('id', tacticId);

      if (error) throw error;

      message.success('Схема наценок удалена');
      await fetchTactics();

      // Сбрасываем выбранную тактику, если удалена текущая
      if (currentTacticId === tacticId) {
        setCurrentTacticId(null);
        setCurrentTacticName('');
        setSelectedTacticId(null);
      }
    } catch (error) {
      console.error('Error deleting tactic:', error);
      message.error('Ошибка удаления схемы наценок');
    }
  }, [currentTacticId, fetchTactics]);

  const updateTacticName = useCallback(async (tacticId: string, newName: string) => {
    try {
      const { error } = await supabase
        .from('markup_tactics')
        .update({ tactic_name: newName })
        .eq('id', tacticId);

      if (error) throw error;

      message.success('Название схемы обновлено');
      setTactics(prev =>
        prev.map(t => (t.id === tacticId ? { ...t, tactic_name: newName } : t))
      );

      if (currentTacticId === tacticId) {
        setCurrentTacticName(newName);
      }
    } catch (error) {
      console.error('Error updating tactic name:', error);
      message.error('Ошибка обновления названия схемы');
    }
  }, [currentTacticId]);

  const startEditingName = useCallback((name: string) => {
    setEditingName(name);
    setIsEditingName(true);
  }, []);

  const cancelEditingName = useCallback(() => {
    setIsEditingName(false);
    setEditingName('');
  }, []);

  const saveEditingName = useCallback(async () => {
    if (!currentTacticId || !editingName.trim()) {
      message.error('Название не может быть пустым');
      return;
    }

    await updateTacticName(currentTacticId, editingName.trim());
    setIsEditingName(false);
    setEditingName('');
  }, [currentTacticId, editingName, updateTacticName]);

  return {
    tactics,
    loadingTactics,
    selectedTacticId,
    currentTacticId,
    currentTacticName,
    isEditingName,
    editingName,
    tacticSearchText,
    setTactics,
    setSelectedTacticId,
    setCurrentTacticId,
    setCurrentTacticName,
    setEditingName,
    setTacticSearchText,
    fetchTactics,
    createNewTactic,
    copyTactic,
    deleteTactic,
    updateTacticName,
    startEditingName,
    cancelEditingName,
    saveEditingName,
  };
};
