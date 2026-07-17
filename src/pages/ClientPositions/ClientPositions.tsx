import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import { Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { useWorkspaceTabActions } from '../../contexts/WorkspaceTabsContext';
import { buildPositionTabPath } from '../../lib/cache/workspaceTabsStorage';
import { setRow as seedPositionRow } from '../../lib/cache/positionRowCache';
import { useAuth } from '../../contexts/AuthContext';
import { useClientPositions } from './hooks/useClientPositions';
import { usePositionActions } from './hooks/usePositionActions';
import { usePositionDelete } from './hooks/usePositionDelete';
import { usePositionFilters } from './hooks/usePositionFilters';
import { useUndoableSet } from './hooks/useUndoableSet';
import { useDeadlineCheck } from '../../hooks/useDeadlineCheck';
import { TenderSelectionScreen } from './components/TenderSelectionScreen';
import { PositionToolbar } from './components/PositionToolbar';
import { DeadlineBar } from './components/DeadlineBar';
import { PositionTable } from './components/PositionTable';
import AddAdditionalPositionModal from './AddAdditionalPositionModal';
import { MassBoqImportModal } from './components/MassBoqImportModal';
import type { Tender } from '../../lib/types';
import { collectSectionDescendants } from '../../utils/positions/collectSectionDescendants';
import { useIsMobile } from '../../hooks/useIsMobile';
import { filterPositionsBySearch } from './utils/positionSearch';
import { useUndoHotkey } from './hooks/useUndoHotkey';
import { PositionCardList } from './components/PositionCardList';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';

dayjs.extend(duration);

interface TenderOption {
  value: string;
  label: string;
  clientName: string;
}

const ClientPositions: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // См. handleRowClick: react-router пересоздаёт navigate на каждую навигацию, поэтому
  // держим его в ref — иначе обработчик клика меняет идентичность и пробивает memo списка.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { openPositionTab } = useWorkspaceTabActions();
  const { theme: currentTheme } = useTheme();
  const { isPhoneDevice } = useIsMobile();

  // State management
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [additionalModalOpen, setAdditionalModalOpen] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  // Набор выбора строк в фильтр с историей шагов для отмены через Ctrl+Z.
  const filterSel = useUndoableSet();
  const tempSelectedPositionIds = filterSel.value;
  const [massImportModalOpen, setMassImportModalOpen] = useState(false);
  const [showAllPositions, setShowAllPositions] = useState(false);
  const [tableScrollY, setTableScrollY] = useState(600);
  const [positionSearchQuery, setPositionSearchQuery] = useState('');
  const deferredPositionSearchQuery = useDeferredValue(positionSearchQuery);
  // Телефон: шапка свёрнута при открытии страницы (максимум высоты под список позиций).
  // Гейт по isPhoneDevice — на десктопе шапка всегда развёрнута.
  const [headerCollapsed, setHeaderCollapsed] = useState(true);
  const headerIsCollapsed = isPhoneDevice && headerCollapsed;

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
    applyLocalBoqClear,
    applyLocalNoteUpdate,
    applyLocalPositionRemove,
  } = useClientPositions();

  // Проверка дедлайна — должна быть объявлена ДО хуков-actions, чтобы
  // прокинуть `readOnly` в их defensive-guard'ы (см. usePositionActions).
  const { canEdit: canEditByDeadline, loading: deadlineLoading } =
    useDeadlineCheck(selectedTender?.id);
  const isReadOnlyByDeadline = !canEditByDeadline || deadlineLoading;

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
    handleExportToExcel,
    handleDeleteAdditionalPosition,
    isLevelChangeMode,
    selectedLevelChangeIds,
    isLevelChanging,
    handleStartLevelChange,
    handleToggleLevelChangeSelection,
    handleCancelLevelChange,
    handleBulkLevelChange,
    clearAllModes,
    undoTargetSelection,
    undoDeleteSelection,
  } = usePositionActions(clientPositions, setClientPositions, setLoading, fetchClientPositions, applyLocalBoqClear, applyLocalNoteUpdate, applyLocalPositionRemove, currentTheme, isReadOnlyByDeadline);

  const {
    isPositionDeleteMode,
    selectedPositionDeleteIds,
    isBulkPositionDeleting,
    handleStartPositionDeleteSelection,
    handleTogglePositionDeleteSelection,
    handleCancelPositionDeleteSelection,
    handleBulkDeletePositions,
    undoPositionDeleteSelection,
  } = usePositionDelete(clientPositions, setLoading, fetchClientPositions, applyLocalPositionRemove, currentTheme, { clearOtherModes: clearAllModes }, isReadOnlyByDeadline);

  // Хук фильтрации позиций и получение информации о пользователе
  const { user } = useAuth();

  // Архивные тендеры отображаются в фильтре для всех пользователей
  const shouldFilterArchived = false;

  // Роли с доступом к изменению уровня иерархии
  const canChangeLevel = ['administrator', 'developer', 'director', 'veduschiy_inzhener'].includes(user?.role_code || '');

  // Роли с доступом к удалению строк заказчика
  const canDeletePositions = ['administrator', 'developer', 'director', 'veduschiy_inzhener'].includes(user?.role_code || '');

  const {
    selectedPositionIds,
    isFilterActive,
    loading: filterLoading,
    saveFilter,
    clearFilter,
    addPositionToFilter,
  } = usePositionFilters(user?.id, selectedTenderId);

  // useDeadlineCheck объявлен выше (после useClientPositions), чтобы прокинуть
  // isReadOnlyByDeadline в usePositionActions/usePositionDelete.

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

  const searchedPositions = useMemo(
    () => filterPositionsBySearch(displayedPositions, deferredPositionSearchQuery),
    [deferredPositionSearchQuery, displayedPositions]
  );

  // При активном фильтре общая сумма считается только по выбранным строкам.
  // positionCounts хранит пер-позиционные итоги (только листовые позиции имеют
  // BOQ-итоги, заголовки разделов — нет), поэтому суммирование по выбранным id
  // не даёт двойного счёта. Условие зеркалит экспорт: «Показать все» → полная сумма.
  const effectiveTotalSum = useMemo(() => {
    if (!isFilterActive || selectedPositionIds.size === 0 || showAllPositions) {
      return totalSum;
    }
    let sum = 0;
    for (const id of selectedPositionIds) sum += positionCounts[id]?.total ?? 0;
    return sum;
  }, [isFilterActive, selectedPositionIds, showAllPositions, totalSum, positionCounts]);

  // Card sticky (top:0): чтобы панель фильтра/импорта доходила до верха при скролле, высота
  // <Card> должна быть ≥ области скролла. tbody целим в «залипшее» состояние: viewport -
  // appHeader(64) - шапка карточки(~48, занижена: при переносе кнопок реальная выше →
  // таблица не короче нужного, панель гарантированно доходит до верха) - thead(40).
  // padding тела карточки = 0 (styles.body.padding:0), таб-бар вкладок при скролле уезжает.
  useEffect(() => {
    const update = () => {
      setTableScrollY(Math.max(300, window.innerHeight - 64 - 48 - 40));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    setPositionSearchQuery('');
  }, [selectedTenderId]);

  // Обработка выбора наименования тендера. useCallback — пропсы PositionToolbar
  // должны быть стабильны на вводе в поиск, иначе его memo пробивается на каждый символ.
  const handleTenderTitleChange = useCallback((title: string) => {
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
      setSearchParams({ tenderId: latest.id });
    } else {
      setSelectedTender(null);
      setSelectedTenderId(null);
      setSelectedVersion(null);
      setClientPositions([]);
      setSearchParams({});
    }
  }, [tenders, shouldFilterArchived, setSelectedTender, setClientPositions, fetchClientPositions, setSearchParams]);

  // Обработка выбора версии тендера
  const handleVersionChange = useCallback((version: number) => {
    setSelectedVersion(version);
    const tender = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (tender) {
      setSelectedTender(tender);
      setSelectedTenderId(tender.id);
      fetchClientPositions(tender.id);
      setSearchParams({ tenderId: tender.id });
    }
  }, [tenders, selectedTenderTitle, setSelectedTender, fetchClientPositions, setSearchParams]);

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
    // fetchClientPositions and setSelectedTender are stable; intentionally excluded to avoid refetch loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, tenders, selectedTender]);

  // Обработчики модального окна
  const handleOpenAdditionalModal = useCallback((parentId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedParentId(parentId);
    setAdditionalModalOpen(true);
  }, []);

  const handleAdditionalSuccess = useCallback((newPositionId: string) => {
    setAdditionalModalOpen(false);
    setSelectedParentId(null);
    if (selectedTenderId) {
      fetchClientPositions(selectedTenderId);
    }
    if (isFilterActive) {
      addPositionToFilter(newPositionId);
    }
  }, [selectedTenderId, isFilterActive, fetchClientPositions, addPositionToFilter]);

  const handleAdditionalCancel = useCallback(() => {
    setAdditionalModalOpen(false);
    setSelectedParentId(null);
  }, []);

  const handleMassImportClose = useCallback(() => {
    setMassImportModalOpen(false);
    // Обновляем всегда: при частичной/ошибочной загрузке уже
    // закоммиченные строки иначе не появятся до ручной перезагрузки.
    if (selectedTenderId) {
      fetchClientPositions(selectedTenderId);
    }
  }, [selectedTenderId, fetchClientPositions]);

  // Обработчик клика по строке — открываем позицию внутренней вкладкой приложения.
  //
  // navigate держим в ref и НЕ включаем в deps: react-router мемоизирует его с
  // locationPathname в зависимостях, поэтому на КАЖДУЮ навигацию он новый → новый
  // handleRowClick → пробивает React.memo у PositionCardList → полная перерисовка списка
  // на текущем count (а count растёт со скроллом и не сбрасывается). Это и есть тормоз
  // при переключении/открытии вкладок. Ref безопасен: зовём только из обработчика
  // события, где .current всегда актуален, а не во время рендера.
  //
  // clientPositions/leafPositionIndices оставляем в deps: они навигационно-стабильны, а
  // ref сделал бы поиск строки для seedPositionRow протухшим.
  const handleRowClick = useCallback((record: { id: string; position_number?: number }) => {
    const isLeaf = leafPositionIndices.has(record.id);
    if (isLeaf && selectedTender) {
      // Ре-стемп кликнутой строки перед навигацией. Массовый setRows на загрузке списка
      // (useClientPositions) ставит метку один раз и не обновляет её на чтении, а TTL 60 c —
      // значит клик позже минуты попадал в промах и давал скелетон, как и из «Формы КП».
      // Здесь разрыв запись→чтение ~1 кадр, поэтому быстрый путь перестаёт зависеть от
      // времени на списке. Именно setRow, а НЕ setRows([row]): setRows всегда зовёт
      // pruneExpired (полный скан localStorage с JSON.parse каждой записи) — в обработчике
      // клика это залипание перед переходом.
      const row = clientPositions.find((p) => p.id === record.id);
      if (row) seedPositionRow(row);
      openPositionTab({
        positionId: record.id,
        tenderId: selectedTender.id,
        title: record.position_number != null ? `№ ${record.position_number}` : 'Позиция',
      });
      navigateRef.current(buildPositionTabPath(record.id, selectedTender.id));
    }
  }, [leafPositionIndices, selectedTender, clientPositions, openPositionTab]);


  // Обработчик клика по карточке тендера
  const handleTenderCardClick = (tender: Tender) => {
    setSelectedTenderTitle(tender.title);
    setSelectedVersion(tender.version || 1);
    setSelectedTender(tender);
    setSelectedTenderId(tender.id);
    fetchClientPositions(tender.id);
    setSearchParams({ tenderId: tender.id });
  };

  // Обработчики фильтра
  const handleToggleFilterCheckbox = (positionId: string) => {
    const idsToToggle = collectSectionDescendants(clientPositions, positionId);
    if (idsToToggle.size === 0) return;

    filterSel.apply(prev => {
      const newSet = new Set(prev);
      const isSelected = newSet.has(positionId);
      for (const id of idsToToggle) {
        if (isSelected) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
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
    filterSel.reset();
    setShowAllPositions(false);
  };

  const handleToggleShowAll = () => {
    setShowAllPositions(prev => !prev);
  };

  // Синхронизация tempSelectedPositionIds с загруженным фильтром.
  // reset — это новый baseline (в историю отмены не попадает).
  useEffect(() => {
    filterSel.reset(selectedPositionIds);
    // filterSel.reset стабилен (useCallback); зависимость только от данных фильтра.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPositionIds]);

  // Ctrl+Z — отмена последнего шага выбора строк в активном режиме отбора.
  useUndoHotkey((): boolean => {
    if (isDeleteSelectionMode) return undoDeleteSelection();
    if (isPositionDeleteMode) return undoPositionDeleteSelection();
    if (isLevelChangeMode) return false; // изменение уровня — вне охвата отмены
    if (copiedPositionId || copiedNotePositionId) return undoTargetSelection();
    return filterSel.undo();
  });

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
      <div
        // Телефон: тап по всей шапке сворачивает/разворачивает её — отдельной кнопки нет.
        // Селекты и кнопки-ссылки гасят всплытие у себя (см. PositionToolbar).
        onClick={isPhoneDevice ? () => setHeaderCollapsed((v) => !v) : undefined}
        aria-expanded={isPhoneDevice ? !headerIsCollapsed : undefined}
        style={{
          background: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
          borderRadius: '8px',
          // Телефон: прижимаем шапку к строке вкладок (оставшиеся 8px — padding <Content>).
          marginTop: isPhoneDevice ? 0 : 8,
          cursor: isPhoneDevice ? 'pointer' : undefined,
        }}
      >
        <PositionToolbar
          selectedTender={selectedTender}
          selectedTenderTitle={selectedTenderTitle}
          selectedVersion={selectedVersion}
          tenderTitles={tenderTitles}
          versions={versions}
          currentTheme={currentTheme}
          totalSum={effectiveTotalSum}
          collapsed={headerIsCollapsed}
          onTenderTitleChange={handleTenderTitleChange}
          onVersionChange={handleVersionChange}
        />

        {!headerIsCollapsed && (
          <DeadlineBar selectedTender={selectedTender} currentTheme={currentTheme} />
        )}
      </div>

      {/* Таблица позиций заказчика (на телефоне — карточный read-only список) */}
      {selectedTender && isPhoneDevice && (
        <div style={{ marginTop: 16 }}>
          {/* Поле поиска живёт ЗДЕСЬ, а не внутри PositionCardList: контролируемому Input
              нужно недеферренное значение, и, находясь внутри мемоизированного списка, оно
              пробивало memo на каждый символ — список перерисовывался целиком на текущем
              (выросшем со скроллом) count, полностью обнуляя useDeferredValue ниже.
              Держим его вне ветки loading/empty, иначе поле исчезает на пустой выдаче. */}
          <Input
            allowClear
            value={positionSearchQuery}
            onChange={(event) => setPositionSearchQuery(event.target.value)}
            placeholder="Поиск по номеру и наименованию"
            prefix={<SearchOutlined />}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <PositionCardList
            clientPositions={searchedPositions}
            selectedTender={selectedTender}
            loading={loading || filterLoading}
            positionCounts={positionCounts}
            leafPositionIndices={leafPositionIndices}
            searchKey={deferredPositionSearchQuery}
            onRowClick={handleRowClick}
          />
        </div>
      )}

      {selectedTender && !isPhoneDevice && (
        <PositionTable
          clientPositions={searchedPositions}
          selectedTender={selectedTender}
          loading={loading || filterLoading}
          copiedPositionId={copiedPositionId}
          copiedNotePositionId={copiedNotePositionId}
          selectedTargetIds={selectedTargetIds}
          isBulkPasting={isBulkPasting}
          positionCounts={positionCounts}
          currentTheme={currentTheme}
          leafPositionIndices={leafPositionIndices}
          readOnly={isReadOnlyByDeadline}
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
          isLevelChangeMode={isLevelChangeMode}
          selectedLevelChangeIds={selectedLevelChangeIds}
          isLevelChanging={isLevelChanging}
          onStartLevelChange={handleStartLevelChange}
          onToggleLevelChangeSelection={handleToggleLevelChangeSelection}
          onCancelLevelChange={handleCancelLevelChange}
          onBulkLevelChange={() => handleBulkLevelChange(selectedTenderId)}
          canChangeLevel={canChangeLevel}
          isPositionDeleteMode={isPositionDeleteMode}
          selectedPositionDeleteIds={selectedPositionDeleteIds}
          isBulkPositionDeleting={isBulkPositionDeleting}
          onStartPositionDeleteSelection={handleStartPositionDeleteSelection}
          onTogglePositionDeleteSelection={handleTogglePositionDeleteSelection}
          onCancelPositionDeleteSelection={handleCancelPositionDeleteSelection}
          onBulkDeletePositions={() => handleBulkDeletePositions(selectedTenderId)}
          canDeletePositions={canDeletePositions}
          onExportToExcel={() => handleExportToExcel(
            selectedTender,
            isFilterActive && !showAllPositions ? selectedPositionIds : null
          )}
          onMassImport={() => setMassImportModalOpen(true)}
          searchQuery={positionSearchQuery}
          onSearchQueryChange={setPositionSearchQuery}
          tempSelectedPositionIds={tempSelectedPositionIds}
          onToggleFilterCheckbox={handleToggleFilterCheckbox}
          onApplyFilter={handleApplyFilter}
          onClearFilter={handleClearFilter}
          showAllPositions={showAllPositions}
          onToggleShowAll={handleToggleShowAll}
          tableScrollY={tableScrollY}
        />
      )}

      {/* Модальное окно добавления доп работы */}
      <AddAdditionalPositionModal
        open={additionalModalOpen}
        parentPositionId={selectedParentId}
        tenderId={selectedTenderId || ''}
        disabled={isReadOnlyByDeadline}
        onCancel={handleAdditionalCancel}
        onSuccess={handleAdditionalSuccess}
      />

      {/* Модальное окно массового импорта BOQ */}
      <MassBoqImportModal
        open={massImportModalOpen}
        tenderId={selectedTenderId || ''}
        tenderTitle={selectedTender?.title || ''}
        onClose={handleMassImportClose}
      />
    </div>
  );
};

export default ClientPositions;
