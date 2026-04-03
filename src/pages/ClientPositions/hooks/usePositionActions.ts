import { useState } from 'react';
import { message, Modal } from 'antd';
import { supabase, type ClientPosition } from '../../../lib/supabase';
import { copyBoqItems } from '../../../utils/copyBoqItems';
import { exportPositionsToExcel } from '../../../utils/excel';
import { pluralize } from '../../../utils/pluralize';

export const usePositionActions = (
  _clientPositions: ClientPosition[],
  setClientPositions: React.Dispatch<React.SetStateAction<ClientPosition[]>>,
  setLoading: (loading: boolean) => void,
  fetchClientPositions: (tenderId: string) => Promise<void>,
  currentTheme: string,
  positionCounts: Record<string, { works: number; materials: number; total: number }>,
  setPositionCounts: React.Dispatch<React.SetStateAction<Record<string, { works: number; materials: number; total: number }>>>,
  setTotalSum: React.Dispatch<React.SetStateAction<number>>,
) => {
  const [copiedPositionId, setCopiedPositionId] = useState<string | null>(null);
  const [copiedNoteValue, setCopiedNoteValue] = useState<string | null>(null);
  const [copiedNotePositionId, setCopiedNotePositionId] = useState<string | null>(null);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(new Set());
  const [isBulkPasting, setIsBulkPasting] = useState(false);
  const [isDeleteSelectionMode, setIsDeleteSelectionMode] = useState(false);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isLevelChangeMode, setIsLevelChangeMode] = useState(false);
  const [selectedLevelChangeIds, setSelectedLevelChangeIds] = useState<Set<string>>(new Set());
  const [isLevelChanging, setIsLevelChanging] = useState(false);

  // Копирование позиции
  const handleCopyPosition = (positionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setCopiedPositionId(positionId);
    setSelectedTargetIds(new Set());
    setIsDeleteSelectionMode(false);
    setSelectedDeleteIds(new Set());
    message.success('Позиция скопирована в буфер обмена');
  };

  // Вставка позиции — оптимистичное обновление счётчиков из уже известных данных источника
  const handlePastePosition = async (targetPositionId: string, event: React.MouseEvent, selectedTenderId: string | null) => {
    event.stopPropagation();
    if (!copiedPositionId) return;

    setLoading(true);
    try {
      const result = await copyBoqItems(copiedPositionId, targetPositionId);
      message.success(`Вставлено: ${result.worksCount} работ, ${result.materialsCount} материалов`);
      setCopiedPositionId(null);

      // Оптимистичное обновление: источник → цель (без re-fetch)
      const src = positionCounts[copiedPositionId];
      if (src) {
        setPositionCounts(prev => ({
          ...prev,
          [targetPositionId]: {
            works: (prev[targetPositionId]?.works || 0) + src.works,
            materials: (prev[targetPositionId]?.materials || 0) + src.materials,
            total: (prev[targetPositionId]?.total || 0) + src.total,
          },
        }));
        setTotalSum(prev => prev + src.total);
      }
    } catch (error: any) {
      console.error('Ошибка вставки:', error);
      message.error('Ошибка вставки: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Toggle выбора строки для массовой вставки
  const handleToggleSelection = (positionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (positionId === copiedPositionId) {
      message.warning('Нельзя вставить позицию саму в себя');
      return;
    }
    setSelectedTargetIds(prev => {
      const s = new Set(prev);
      s.has(positionId) ? s.delete(positionId) : s.add(positionId);
      return s;
    });
  };

  // Массовая вставка — параллельные запросы + оптимистичное обновление
  const handleBulkPaste = async (selectedTenderId: string | null) => {
    if (!copiedPositionId || selectedTargetIds.size === 0) return;

    setIsBulkPasting(true);
    const targets = Array.from(selectedTargetIds);
    try {
      const results = await Promise.all(
        targets.map(id => copyBoqItems(copiedPositionId, id).catch(() => null))
      );

      const succeeded = results.filter(Boolean).length;
      const failed = targets.length - succeeded;

      if (failed === 0) {
        message.success(`Успешно вставлено в ${succeeded} ${pluralize(succeeded, 'позицию', 'позиции', 'позиций')}`);
      } else {
        message.warning(`Вставлено в ${succeeded} из ${targets.length} позиций`);
      }

      setSelectedTargetIds(new Set());
      setCopiedPositionId(null);

      // Оптимистичное обновление счётчиков для успешных целей
      const src = positionCounts[copiedPositionId];
      if (src) {
        setPositionCounts(prev => {
          const next = { ...prev };
          results.forEach((r, i) => {
            if (r) {
              const id = targets[i];
              next[id] = {
                works: (next[id]?.works || 0) + src.works,
                materials: (next[id]?.materials || 0) + src.materials,
                total: (next[id]?.total || 0) + src.total,
              };
            }
          });
          return next;
        });
        setTotalSum(prev => prev + src.total * succeeded);
      }
    } catch (error: any) {
      console.error('Ошибка массовой вставки:', error);
      message.error('Ошибка массовой вставки: ' + error.message);
    } finally {
      setIsBulkPasting(false);
    }
  };

  // Экспорт в Excel
  const handleExportToExcel = async (selectedTender: any) => {
    if (!selectedTender) { message.error('Выберите тендер для экспорта'); return; }
    const hideLoading = message.loading('Формирование Excel файла...', 0);
    try {
      await exportPositionsToExcel(selectedTender.id, selectedTender.title, selectedTender.version);
      hideLoading();
      message.success('Файл успешно экспортирован');
    } catch (error: any) {
      console.error('Ошибка экспорта:', error);
      hideLoading();
      message.error('Ошибка экспорта: ' + error.message);
    }
  };

  // Копирование примечания ГП
  const handleCopyNote = (positionId: string, noteValue: string | null, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!noteValue || noteValue.trim() === '') {
      message.warning('Примечание ГП пустое. Нечего копировать.');
      return;
    }
    setCopiedNoteValue(noteValue);
    setCopiedNotePositionId(positionId);
    setSelectedTargetIds(new Set());
    setIsDeleteSelectionMode(false);
    setSelectedDeleteIds(new Set());
    message.success('Примечание ГП скопировано в буфер обмена');
  };

  // Вставка примечания ГП — обновляем состояние напрямую без re-fetch
  const handlePasteNote = async (targetPositionId: string, event: React.MouseEvent, _selectedTenderId: string | null) => {
    event.stopPropagation();
    if (!copiedNoteValue || !copiedNotePositionId) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('client_positions')
        .update({ manual_note: copiedNoteValue })
        .eq('id', targetPositionId);
      if (error) throw error;

      setCopiedNoteValue(null);
      setCopiedNotePositionId(null);

      // Точечное обновление состояния без re-fetch
      setClientPositions(prev =>
        prev.map(p => p.id === targetPositionId ? { ...p, manual_note: copiedNoteValue } : p)
      );
      message.success('Примечание ГП успешно вставлено');
    } catch (error: any) {
      console.error('Ошибка вставки примечания:', error);
      message.error('Ошибка вставки примечания: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Массовая вставка примечания ГП — один запрос к БД + точечное обновление состояния
  const handleBulkPasteNote = async (selectedTenderId: string | null) => {
    if (!copiedNoteValue || !copiedNotePositionId || selectedTargetIds.size === 0) return;

    setIsBulkPasting(true);
    const targets = Array.from(selectedTargetIds);
    try {
      const results = await Promise.all(
        targets.map(id =>
          supabase.from('client_positions').update({ manual_note: copiedNoteValue }).eq('id', id)
            .then(r => ({ id, ok: !r.error }))
        )
      );

      const succeeded = results.filter(r => r.ok).length;
      const failed = targets.length - succeeded;
      if (failed === 0) {
        message.success(`Успешно вставлено примечание в ${succeeded} ${pluralize(succeeded, 'позицию', 'позиции', 'позиций')}`);
      } else {
        message.warning(`Вставлено примечание в ${succeeded} из ${targets.length} позиций`);
      }

      const succeededIds = new Set(results.filter(r => r.ok).map(r => r.id));
      const note = copiedNoteValue;

      setSelectedTargetIds(new Set());
      setCopiedNoteValue(null);
      setCopiedNotePositionId(null);

      // Точечное обновление состояния без re-fetch
      setClientPositions(prev =>
        prev.map(p => succeededIds.has(p.id) ? { ...p, manual_note: note } : p)
      );
    } catch (error: any) {
      console.error('Ошибка массовой вставки примечания:', error);
      message.error('Ошибка массовой вставки примечания: ' + error.message);
    } finally {
      setIsBulkPasting(false);
    }
  };

  // Вход в режим массового удаления работ и материалов
  const handleStartDeleteSelection = (positionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setCopiedPositionId(null);
    setCopiedNoteValue(null);
    setCopiedNotePositionId(null);
    setSelectedTargetIds(new Set());
    setIsDeleteSelectionMode(true);
    setSelectedDeleteIds(new Set([positionId]));
  };

  const handleToggleDeleteSelection = (positionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedDeleteIds(prev => {
      const s = new Set(prev);
      s.has(positionId) ? s.delete(positionId) : s.add(positionId);
      return s;
    });
  };

  const handleCancelDeleteSelection = () => {
    setIsDeleteSelectionMode(false);
    setSelectedDeleteIds(new Set());
  };

  // Массовое удаление BOQ — параллельные запросы + точечное обновление состояния
  const handleBulkDeleteBoqItems = async (selectedTenderId: string | null) => {
    if (selectedDeleteIds.size === 0) return;
    const count = selectedDeleteIds.size;

    Modal.confirm({
      title: 'Удалить работы и материалы?',
      content: `Вы уверены, что хотите удалить все работы и материалы из ${count} ${pluralize(count, 'позиции', 'позиций', 'позиций')}? Это действие нельзя отменить.`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: currentTheme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        setIsBulkDeleting(true);
        setLoading(true);
        try {
          const positionIds = Array.from(selectedDeleteIds);
          const batchSize = 100;
          const batches: string[][] = [];
          for (let i = 0; i < positionIds.length; i += batchSize) batches.push(positionIds.slice(i, i + batchSize));

          // Параллельное удаление boq_items и обнуление totals
          await Promise.all([
            ...batches.map(b => supabase.from('boq_items').delete().in('client_position_id', b)),
            ...batches.map(b => supabase.from('client_positions').update({ total_material: 0, total_works: 0 }).in('id', b)),
          ]);

          // Обновляем состояние без re-fetch
          const deletedTotal = positionIds.reduce((s, id) => s + (positionCounts[id]?.total || 0), 0);
          setPositionCounts(prev => {
            const next = { ...prev };
            positionIds.forEach(id => { next[id] = { works: 0, materials: 0, total: 0 }; });
            return next;
          });
          setTotalSum(prev => prev - deletedTotal);

          setSelectedDeleteIds(new Set());
          setIsDeleteSelectionMode(false);
          message.success(`Работы и материалы удалены из ${count} ${pluralize(count, 'позиции', 'позиций', 'позиций')}`);
        } catch (error: any) {
          console.error('Ошибка массового удаления:', error);
          message.error('Ошибка удаления: ' + error.message);
        } finally {
          setIsBulkDeleting(false);
          setLoading(false);
        }
      },
    });
  };

  // Очистка BOQ одной позиции — точечное обновление состояния
  const handleClearPositionBoqItems = async (
    positionId: string,
    positionName: string,
    selectedTenderId: string | null,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    Modal.confirm({
      title: 'Удалить работы и материалы?',
      content: `Удалить все работы и материалы из позиции "${positionName}"? Это действие нельзя отменить.`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: currentTheme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        setLoading(true);
        try {
          await Promise.all([
            supabase.from('boq_items').delete().eq('client_position_id', positionId),
            supabase.from('client_positions').update({ total_material: 0, total_works: 0 }).eq('id', positionId),
          ]);

          const oldTotal = positionCounts[positionId]?.total || 0;
          setPositionCounts(prev => ({ ...prev, [positionId]: { works: 0, materials: 0, total: 0 } }));
          setTotalSum(prev => prev - oldTotal);

          message.success('Работы и материалы удалены');
        } catch (error: any) {
          console.error('Ошибка очистки позиции:', error);
          message.error('Ошибка очистки: ' + error.message);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // Удаление ДОП работы — удаляем из состояния без re-fetch
  const handleDeleteAdditionalPosition = async (
    positionId: string,
    positionName: string,
    selectedTenderId: string | null,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    Modal.confirm({
      title: 'Удалить ДОП работу?',
      content: `Вы действительно хотите удалить ДОП работу "${positionName}"? Все связанные работы и материалы также будут удалены.`,
      okText: 'Да, удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: currentTheme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        setLoading(true);
        try {
          await supabase.from('boq_items').delete().eq('client_position_id', positionId);
          const { error } = await supabase.from('client_positions').delete().eq('id', positionId);
          if (error) throw error;

          const oldTotal = positionCounts[positionId]?.total || 0;
          setClientPositions(prev => prev.filter(p => p.id !== positionId));
          setPositionCounts(prev => { const n = { ...prev }; delete n[positionId]; return n; });
          setTotalSum(prev => prev - oldTotal);

          message.success('ДОП работа успешно удалена');
        } catch (error: any) {
          console.error('Ошибка удаления ДОП работы:', error);
          message.error('Ошибка удаления: ' + error.message);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // Вход в режим изменения уровня иерархии
  const handleStartLevelChange = (event: React.MouseEvent) => {
    event.stopPropagation();
    setCopiedPositionId(null); setCopiedNoteValue(null); setCopiedNotePositionId(null);
    setSelectedTargetIds(new Set()); setIsDeleteSelectionMode(false); setSelectedDeleteIds(new Set());
    setIsLevelChangeMode(true); setSelectedLevelChangeIds(new Set());
  };

  const handleToggleLevelChangeSelection = (positionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedLevelChangeIds(prev => {
      const s = new Set(prev);
      s.has(positionId) ? s.delete(positionId) : s.add(positionId);
      return s;
    });
  };

  const handleCancelLevelChange = () => {
    setIsLevelChangeMode(false);
    setSelectedLevelChangeIds(new Set());
  };

  // Изменение уровня иерархии — параллельные запросы + точечное обновление состояния
  const handleBulkLevelChange = async (selectedTenderId: string | null) => {
    if (selectedLevelChangeIds.size === 0) return;
    const count = selectedLevelChangeIds.size;

    Modal.confirm({
      title: 'Понизить уровень иерархии?',
      content: `Понизить уровень иерархии на 1 у ${count} ${pluralize(count, 'позиции', 'позиций', 'позиций')}?`,
      okText: 'Подтвердить',
      cancelText: 'Отмена',
      rootClassName: currentTheme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        setIsLevelChanging(true);
        setLoading(true);
        try {
          const positionIds = Array.from(selectedLevelChangeIds);
          const { data: positions, error } = await supabase
            .from('client_positions')
            .select('id, hierarchy_level')
            .in('id', positionIds);
          if (error) throw error;

          // Параллельные обновления
          await Promise.all(
            (positions || []).map(pos =>
              supabase.from('client_positions')
                .update({ hierarchy_level: (pos.hierarchy_level || 0) + 1 })
                .eq('id', pos.id)
            )
          );

          // Обновляем состояние без re-fetch
          const levelMap = new Map((positions || []).map(p => [p.id, (p.hierarchy_level || 0) + 1]));
          setClientPositions(prev =>
            prev.map(p => levelMap.has(p.id) ? { ...p, hierarchy_level: levelMap.get(p.id)! } : p)
          );

          setSelectedLevelChangeIds(new Set());
          setIsLevelChangeMode(false);
          message.success(`Уровень иерархии понижен у ${count} ${pluralize(count, 'позиции', 'позиций', 'позиций')}`);
        } catch (error: any) {
          console.error('Ошибка изменения уровня:', error);
          message.error('Ошибка изменения уровня: ' + error.message);
        } finally {
          setIsLevelChanging(false);
          setLoading(false);
        }
      },
    });
  };

  const clearAllModes = () => {
    setCopiedPositionId(null); setCopiedNoteValue(null); setCopiedNotePositionId(null);
    setSelectedTargetIds(new Set()); setIsDeleteSelectionMode(false); setSelectedDeleteIds(new Set());
    setIsLevelChangeMode(false); setSelectedLevelChangeIds(new Set());
  };

  return {
    copiedPositionId,
    copiedNotePositionId,
    selectedTargetIds,
    isBulkPasting,
    isDeleteSelectionMode,
    selectedDeleteIds,
    isBulkDeleting,
    isLevelChangeMode,
    selectedLevelChangeIds,
    isLevelChanging,
    handleCopyPosition,
    handlePastePosition,
    handleToggleSelection,
    handleBulkPaste,
    handleCopyNote,
    handlePasteNote,
    handleBulkPasteNote,
    handleStartDeleteSelection,
    handleToggleDeleteSelection,
    handleCancelDeleteSelection,
    handleBulkDeleteBoqItems,
    handleClearPositionBoqItems,
    handleExportToExcel,
    handleDeleteAdditionalPosition,
    handleStartLevelChange,
    handleToggleLevelChangeSelection,
    handleCancelLevelChange,
    handleBulkLevelChange,
    clearAllModes,
  };
};
