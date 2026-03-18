import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useClientPositions } from './hooks/useClientPositions';
import { usePositionActions } from './hooks/usePositionActions';
import { usePositionFilters } from './hooks/usePositionFilters';
import { useDeadlineCheck } from '../../hooks/useDeadlineCheck';
import { TenderSelectionScreen } from './components/TenderSelectionScreen';
import { PositionToolbar } from './components/PositionToolbar';
import { DeadlineBar } from './components/DeadlineBar';
import { PositionTable } from './components/PositionTable';
import AddAdditionalPositionModal from './AddAdditionalPositionModal';
import { MassBoqImportModal } from './components/MassBoqImportModal';
import type { Tender } from '../../lib/supabase';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';

dayjs.extend(duration);

interface TenderOption {
  value: string;
  label: string;
  clientName: string;
}

const ClientPositions: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme: currentTheme } = useTheme();

  // State management
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [additionalModalOpen, setAdditionalModalOpen] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [tempSelectedPositionIds, setTempSelectedPositionIds] = useState<Set<string>>(new Set());
  const [massImportModalOpen, setMassImportModalOpen] = useState(false);
  const [showAllPositions, setShowAllPositions] = useState(false);

  // Hooks
  const {
    tenders,
    selectedTender,
    setSelectedTender,
    clientPositions,
    setClientPositions,
    loading,
    setLoading,
    positionCounts,
    totalSum,
    leafPositionIndices,
    fetchClientPositions,
  } = useClientPositions();

  const {
    copiedPositionId,
    copiedNotePositionId,
    selectedTargetIds,
    isBulkPasting,
    isDeleteSelectionMode,
    selectedDeleteIds,
    isBulkDeleting,
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
    isLevelChangeMode,
    selectedLevelChangeIds,
    isLevelChanging,
    handleStartLevelChange,
    handleToggleLevelChangeSelection,
    handleCancelLevelChange,
    handleBulkLevelChange,
  } = usePositionActions(clientPositions, setClientPositions, setLoading, fetchClientPositions, currentTheme);

  // Хук фильтрации позиций и получение информации о пользователе
  const { user } = useAuth();

  // Проверка роли для фильтрации архивных тендеров
  const shouldFilterArchived = user?.role_code === 'engineer' || user?.role_code === 'moderator';

  // Роли с доступом к изменению уровня иерархии
  const canChangeLevel = ['administrator', 'developer', 'director', 'veduschiy_inzhener'].includes(user?.role_code || '');

  const {
    selectedPositionIds,
    isFilterActive,
    loading: filterLoading,
    saveFilter,
    clearFilter,
  } = usePositionFilters(user?.id, selectedTenderId);

  // Проверка дедлайна для блокировки редактирования
  const { canEdit: canEditByDeadline, loading: deadlineLoading } =
    useDeadlineCheck(selectedTender?.id);

  // Получение уникальных наименований тендеров
  const tenderTitles = useMemo((): TenderOption[] => {
    const uniqueTitles = new Map<string, TenderOption>();

    const filteredTenders = shouldFilterArchived
      ? tenders.filter(t => !t.is_archived)
      : tenders;

    filteredTenders.forEach(tender => {
      if (!uniqueTitles.has(tender.title)) {
        uniqueTitles.set(tender.title, {
          value: tender.title,
          label: tender.title,
          clientName: tender.client_name,
        });
      }
    });

    return Array.from(uniqueTitles.values());
  }, [tenders, shouldFilterArchived]);

  // Получение версий для выбранного наименования тендера
  const versions = useMemo((): { value: number; label: string }[] => {
    if (!selectedTenderTitle) return [];

    const filtered = shouldFilterArchived
      ? tenders.filter(tender => tender.title === selectedTenderTitle && !tender.is_archived)
      : tenders.filter(tender => tender.title === selectedTenderTitle);

    return filtered
      .map(tender => ({
        value: tender.version || 1,
        label: `Версия ${tender.version || 1}`,
      }))
      .sort((a, b) => b.value - a.value);
  }, [tenders, selectedTenderTitle, shouldFilterArchived]);

  // Фильтрация позиций в зависимости от активного фильтра
  const displayedPositions = useMemo(() => {
    if (!isFilterActive || selectedPositionIds.size === 0 || showAllPositions) {
      return clientPositions;
    }
    // Строгая фильтрация: показываем только выбранные позиции
    return clientPositions.filter(pos => selectedPositionIds.has(pos.id));
  }, [clientPositions, isFilterActive, selectedPositionIds, showAllPositions]);

  // Обработка выбора наименования тендера
  const handleTenderTitleChange = (title: string) => {
    setSelectedTenderTitle(title);
    // Автоматически выбираем последнюю версию нового тендера
    const versionsOfTitle = tenders
      .filter(t => t.title === title && (!shouldFilterArchived || !t.is_archived))
      .sort((a, b) => (b.version || 1) - (a.version || 1));
    if (versionsOfTitle.length > 0) {
      const latest = versionsOfTitle[0];
      setSelectedVersion(latest.version || 1);
      setSelectedTender(latest);
      setSelectedTenderId(latest.id);
      fetchClientPositions(latest.id);
    } else {
      setSelectedTender(null);
      setSelectedTenderId(null);
      setSelectedVersion(null);
      setClientPositions([]);
    }
  };

  // Обработка выбора версии тендера
  const handleVersionChange = (version: number) => {
    setSelectedVersion(version);
    const tender = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (tender) {
      setSelectedTender(tender);
      setSelectedTenderId(tender.id);
      fetchClientPositions(tender.id);
    }
  };

  // Автоматический выбор тендера из URL параметров
  useEffect(() => {
    const tenderId = searchParams.get('tenderId');
    if (tenderId && tenders.length > 0 && !selectedTender) {
      const tender = tenders.find(t => t.id === tenderId);
      if (tender) {
        setSelectedTenderTitle(tender.title);
        setSelectedVersion(tender.version || 1);
        setSelectedTender(tender);
        setSelectedTenderId(tender.id);
        fetchClientPositions(tender.id);
      }
    }
  }, [searchParams, tenders, selectedTender]);

  // Обработчики модального окна
  const handleOpenAdditionalModal = useCallback((parentId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedParentId(parentId);
    setAdditionalModalOpen(true);
  }, []);

  const handleAdditionalSuccess = () => {
    setAdditionalModalOpen(false);
    setSelectedParentId(null);
    if (selectedTenderId) {
      fetchClientPositions(selectedTenderId);
    }
  };

  // Обработчик клика по строке
  const handleRowClick = useCallback((record: any, index: number) => {
    const isLeaf = leafPositionIndices.has(record.id);
    if (isLeaf && selectedTender) {
      // Открываем в новой вкладке
      const url = `/positions/${record.id}/items?tenderId=${selectedTender.id}&positionId=${record.id}`;
      window.open(url, '_blank');
    }
  }, [leafPositionIndices, selectedTender]);


  // Обработчик возврата к выбору
  const handleBackToSelection = () => {
    setSelectedTender(null);
    setSelectedTenderId(null);
    setSelectedTenderTitle(null);
    setSelectedVersion(null);
    setClientPositions([]);
  };

  // Обработчик клика по карточке тендера
  const handleTenderCardClick = (tender: Tender) => {
    setSelectedTenderTitle(tender.title);
    setSelectedVersion(tender.version || 1);
    setSelectedTender(tender);
    setSelectedTenderId(tender.id);
    fetchClientPositions(tender.id);
  };

  // Обработчики фильтра
  const handleToggleFilterCheckbox = (positionId: string) => {
    const clickedIndex = clientPositions.findIndex(p => p.id === positionId);
    if (clickedIndex === -1) return;

    const clickedPosition = clientPositions[clickedIndex];
    const clickedLevel = clickedPosition.hierarchy_level || 0;

    setTempSelectedPositionIds(prev => {
      const newSet = new Set(prev);
      const isSelected = newSet.has(positionId);

      // Собираем нажатую позицию и дочерних по позиции в массиве + hierarchy_level
      // (вместо item_no prefix, чтобы не захватывать одноимённые разделы из другой части таблицы)
      const idsToToggle = new Set<string>([positionId]);
      for (let i = clickedIndex + 1; i < clientPositions.length; i++) {
        const pos = clientPositions[i];

        // Пропускаем ДОП-позиции при определении границы раздела
        if (pos.is_additional) continue;

        const posLevel = pos.hierarchy_level || 0;
        // Остановка на позиции того же или более высокого уровня (конец раздела)
        if (posLevel <= clickedLevel) break;

        idsToToggle.add(pos.id);
      }

      // Добавляем ДОП-позиции, привязанные к собранным через parent_position_id
      for (const pos of clientPositions) {
        if (pos.is_additional && pos.parent_position_id && idsToToggle.has(pos.parent_position_id)) {
          idsToToggle.add(pos.id);
        }
      }

      for (const id of idsToToggle) {
        isSelected ? newSet.delete(id) : newSet.add(id);
      }
      return newSet;
    });
  };

  const handleApplyFilter = async () => {
    const positionIds = Array.from(tempSelectedPositionIds);
    await saveFilter(positionIds);
    setShowAllPositions(false);
  };

  const handleClearFilter = async () => {
    await clearFilter();
    setTempSelectedPositionIds(new Set());
    setShowAllPositions(false);
  };

  const handleToggleShowAll = () => {
    setShowAllPositions(prev => !prev);
  };

  // Синхронизация tempSelectedPositionIds с загруженным фильтром
  useEffect(() => {
    setTempSelectedPositionIds(selectedPositionIds);
  }, [selectedPositionIds]);

  // Если тендер не выбран, показываем экран выбора тендера
  if (!selectedTender) {
    return (
      <TenderSelectionScreen
        tenders={tenders}
        selectedTenderTitle={selectedTenderTitle}
        selectedVersion={selectedVersion}
        tenderTitles={tenderTitles}
        versions={versions}
        onTenderTitleChange={handleTenderTitleChange}
        onVersionChange={handleVersionChange}
        onTenderCardClick={handleTenderCardClick}
        shouldFilterArchived={shouldFilterArchived}
      />
    );
  }

  return (
    <div style={{ padding: 0 }}>
      {/* Блок с названием тендера, кнопками, фильтрами и информацией */}
      <div style={{
        background: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
        borderRadius: '8px',
        margin: '16px 0 0 0',
      }}>
        <PositionToolbar
          selectedTender={selectedTender}
          selectedTenderTitle={selectedTenderTitle}
          selectedVersion={selectedVersion}
          tenderTitles={tenderTitles}
          versions={versions}
          currentTheme={currentTheme}
          totalSum={totalSum}
          onTenderTitleChange={handleTenderTitleChange}
          onVersionChange={handleVersionChange}
          onBackToSelection={handleBackToSelection}
        />

        <DeadlineBar selectedTender={selectedTender} currentTheme={currentTheme} />
      </div>

      {/* Таблица позиций заказчика */}
      {selectedTender && (
        <PositionTable
          clientPositions={displayedPositions}
          selectedTender={selectedTender}
          loading={loading || filterLoading}
          copiedPositionId={copiedPositionId}
          copiedNotePositionId={copiedNotePositionId}
          selectedTargetIds={selectedTargetIds}
          isBulkPasting={isBulkPasting}
          positionCounts={positionCounts}
          currentTheme={currentTheme}
          leafPositionIndices={leafPositionIndices}
          readOnly={!canEditByDeadline || deadlineLoading}
          isFilterActive={isFilterActive}
          filterSelectedCount={selectedPositionIds.size}
          totalPositionsCount={clientPositions.length}
          onRowClick={handleRowClick}
          onOpenAdditionalModal={handleOpenAdditionalModal}
          onCopyPosition={handleCopyPosition}
          onPastePosition={(positionId, event) => handlePastePosition(positionId, event, selectedTenderId)}
          onToggleSelection={handleToggleSelection}
          onBulkPaste={() => handleBulkPaste(selectedTenderId)}
          onCopyNote={handleCopyNote}
          onPasteNote={(positionId, event) => handlePasteNote(positionId, event, selectedTenderId)}
          onBulkPasteNote={() => handleBulkPasteNote(selectedTenderId)}
          isDeleteSelectionMode={isDeleteSelectionMode}
          selectedDeleteIds={selectedDeleteIds}
          isBulkDeleting={isBulkDeleting}
          onStartDeleteSelection={(positionId, event) => handleStartDeleteSelection(positionId, event)}
          onToggleDeleteSelection={handleToggleDeleteSelection}
          onCancelDeleteSelection={handleCancelDeleteSelection}
          onBulkDeleteBoqItems={() => handleBulkDeleteBoqItems(selectedTenderId)}
          onDeleteAdditionalPosition={(positionId, positionName, event) =>
            handleDeleteAdditionalPosition(positionId, positionName, selectedTenderId, event)
          }
          onClearPositionBoqItems={(positionId, positionName, event) =>
            handleClearPositionBoqItems(positionId, positionName, selectedTenderId, event)
          }
          isLevelChangeMode={isLevelChangeMode}
          selectedLevelChangeIds={selectedLevelChangeIds}
          isLevelChanging={isLevelChanging}
          onStartLevelChange={handleStartLevelChange}
          onToggleLevelChangeSelection={handleToggleLevelChangeSelection}
          onCancelLevelChange={handleCancelLevelChange}
          onBulkLevelChange={() => handleBulkLevelChange(selectedTenderId)}
          canChangeLevel={canChangeLevel}
          onExportToExcel={() => handleExportToExcel(selectedTender)}
          onMassImport={() => setMassImportModalOpen(true)}
          tempSelectedPositionIds={tempSelectedPositionIds}
          onToggleFilterCheckbox={handleToggleFilterCheckbox}
          onApplyFilter={handleApplyFilter}
          onClearFilter={handleClearFilter}
          showAllPositions={showAllPositions}
          onToggleShowAll={handleToggleShowAll}
        />
      )}

      {/* Модальное окно добавления доп работы */}
      <AddAdditionalPositionModal
        open={additionalModalOpen}
        parentPositionId={selectedParentId}
        tenderId={selectedTenderId || ''}
        onCancel={() => {
          setAdditionalModalOpen(false);
          setSelectedParentId(null);
        }}
        onSuccess={handleAdditionalSuccess}
      />

      {/* Модальное окно массового импорта BOQ */}
      <MassBoqImportModal
        open={massImportModalOpen}
        tenderId={selectedTenderId || ''}
        tenderTitle={selectedTender?.title || ''}
        onClose={(success) => {
          setMassImportModalOpen(false);
          if (success && selectedTenderId) {
            fetchClientPositions(selectedTenderId);
          }
        }}
      />
    </div>
  );
};

export default ClientPositions;
