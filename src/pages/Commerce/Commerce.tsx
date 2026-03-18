/**
 * Страница "Коммерция" - отображение коммерческих стоимостей позиций заказчика
 */

import { Card, Spin, Empty } from 'antd';
import { useCommerceData, useCommerceActions } from './hooks';
import { TenderSelector, CommerceTable, CommerceHeader } from './components';
import { exportCommerceToExcel } from './utils/exportToExcel';
import { useAuth } from '../../contexts/AuthContext';

export default function Commerce() {
  const { user } = useAuth();
  const shouldFilterArchived = user?.role_code === 'engineer' || user?.role_code === 'moderator';

  const {
    loading,
    calculating,
    setCalculating,
    tenders,
    selectedTenderId,
    setSelectedTenderId,
    selectedTenderTitle,
    setSelectedTenderTitle,
    selectedVersion,
    setSelectedVersion,
    positions,
    markupTactics,
    selectedTacticId,
    tacticChanged,
    setTacticChanged,
    loadTenders,
    loadPositions,
    handleTacticChange,
    referenceTotal
  } = useCommerceData();

  const {
    handleRecalculate,
    handleApplyTactic
  } = useCommerceActions(
    selectedTenderId,
    selectedTacticId,
    setCalculating,
    setTacticChanged,
    loadTenders,
    loadPositions
  );

  // Обработка выбора наименования тендера
  const handleTenderTitleChange = (title: string) => {
    setSelectedTenderTitle(title);
    // Автоматически выбираем последнюю версию нового тендера
    const versionsOfTitle = tenders
      .filter(t => t.title === title)
      .sort((a, b) => (b.version || 1) - (a.version || 1));
    if (versionsOfTitle.length > 0) {
      const latest = versionsOfTitle[0];
      setSelectedVersion(latest.version || 1);
      setSelectedTenderId(latest.id);
    } else {
      setSelectedTenderId(undefined);
      setSelectedVersion(null);
    }
  };

  // Обработка выбора версии тендера
  const handleVersionChange = (version: number) => {
    setSelectedVersion(version);
    const tender = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (tender) {
      setSelectedTenderId(tender.id);
    }
  };

  // Обработка выбора тендера из карточек
  const handleTenderSelect = (tenderId: string, title: string, version: number) => {
    setSelectedTenderTitle(title);
    setSelectedVersion(version);
    setSelectedTenderId(tenderId);
  };

  // Обработка возврата к выбору тендера
  const handleBack = () => {
    setSelectedTenderId(undefined);
    setSelectedTenderTitle(null);
    setSelectedVersion(null);
  };

  // Обработка экспорта в Excel
  const handleExportToExcel = () => {
    const selectedTender = tenders.find(t => t.id === selectedTenderId);
    exportCommerceToExcel(positions, selectedTender);
  };

  // Обработка навигации к позиции
  const handleNavigateToPosition = (positionId: string) => {
    if (selectedTenderId) {
      const url = `/positions/${positionId}/items?tenderId=${selectedTenderId}&positionId=${positionId}`;
      window.open(url, '_blank');
    }
  };

  // Если тендер не выбран, показываем только выбор тендера
  if (!selectedTenderId) {
    return (
      <TenderSelector
        tenders={tenders}
        selectedTenderTitle={selectedTenderTitle}
        selectedVersion={selectedVersion}
        onTenderTitleChange={handleTenderTitleChange}
        onVersionChange={handleVersionChange}
        onTenderSelect={handleTenderSelect}
        shouldFilterArchived={shouldFilterArchived}
      />
    );
  }

  return (
    <Card
      bordered={false}
      style={{ height: '100%' }}
      headStyle={{ borderBottom: 'none', paddingBottom: 0 }}
      title={
        <CommerceHeader
          tenders={tenders}
          selectedTenderTitle={selectedTenderTitle}
          selectedVersion={selectedVersion}
          selectedTacticId={selectedTacticId}
          markupTactics={markupTactics}
          tacticChanged={tacticChanged}
          loading={loading}
          calculating={calculating}
          positionsCount={positions.length}
          onBack={handleBack}
          onTenderTitleChange={handleTenderTitleChange}
          onVersionChange={handleVersionChange}
          onTacticChange={handleTacticChange}
          onApplyTactic={handleApplyTactic}
          onRecalculate={handleRecalculate}
          onExport={handleExportToExcel}
          onReload={() => selectedTenderId && loadPositions(selectedTenderId)}
          shouldFilterArchived={shouldFilterArchived}
        />
      }
    >
      {selectedTenderId ? (
        <Spin spinning={loading || calculating}>
          <CommerceTable
            positions={positions}
            selectedTenderId={selectedTenderId}
            onNavigateToPosition={handleNavigateToPosition}
            referenceTotal={referenceTotal}
          />
        </Spin>
      ) : (
        <Empty description="Выберите тендер для просмотра коммерческих стоимостей" />
      )}
    </Card>
  );
}
