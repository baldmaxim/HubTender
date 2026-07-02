/**
 * Страница "Затраты на строительство" (новая версия)
 * Отображение и редактирование объемов затрат по категориям с расчетом стоимостей
 */

import React, { useState } from 'react';
import { Button, Typography, Select, Card } from 'antd';
import { useCostData } from './hooks/useCostData';
import CostFilters from './components/CostFilters';
import CostTable from './components/CostTable';
import { COST_TABLE_FIT_WIDTH } from './components/costTableWidths';
import CategoryPositionsModal from './components/CategoryPositionsModal';
import TenderSelection from './components/TenderSelection';
import CostTotalsBar from './components/CostTotalsBar';
import { exportConstructionCostToExcel } from './utils/exportConstructionCostToExcel';
import { filterCostData } from './utils/filterCostData';
import { computeCostTotals } from './utils/computeTotals';
import { useAuth } from '../../../contexts/AuthContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useTheme } from '../../../contexts/ThemeContext';
import { LandscapeTableOverlay } from '../../../components/responsive/LandscapeTableOverlay';

const { Text } = Typography;

const ConstructionCostNew: React.FC = () => {
  const { user } = useAuth();
  const { isPhone, isLandscapePhone, isMobile, isPhoneDevice } = useIsMobile();
  const { theme: currentTheme } = useTheme();
  // На телефоне страница только для просмотра; редактирование — на планшете/десктопе.
  const readOnly = isMobile || isLandscapePhone;
  const [searchText, setSearchText] = useState('');
  const [viewMode, setViewMode] = useState<'detailed' | 'summary' | 'simplified'>('detailed');
  // На телефоне по умолчанию «Упрощённое», пока пользователь сам не переключит вид.
  const [viewModeTouched, setViewModeTouched] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [modalCategory, setModalCategory] = useState<
    { id: string; detailName: string; categoryName: string } | null
  >(null);

  const {
    tenders,
    selectedTenderId,
    selectedTenderTitle,
    selectedVersion,
    loading,
    data,
    costType,
    setCostType,
    setSelectedTenderId,
    setSelectedTenderTitle,
    setSelectedVersion,
    setData,
    getTenderTitles,
    getVersionsForTitle,
    handleTenderTitleChange,
    handleVersionChange,
    handleVolumeChange,
    handleNotesChange,
  } = useCostData();

  // Проверка роли для фильтрации архивных тендеров в карточках
  const shouldFilterArchived = user?.role_code === 'engineer' || user?.role_code === 'moderator';

  // На телефоне открываем в «упрощённом» виде, но даём переключить (см. viewModeTouched).
  const effectiveViewMode = isPhone && !viewModeTouched ? 'simplified' : viewMode;

  // Обработчик экспорта
  const handleExport = () => {
    if (!selectedTenderId || !selectedTenderTitle) return;

    exportConstructionCostToExcel({
      selectedTenderId,
      selectedTenderTitle,
      selectedVersion,
      costType,
      filteredData,
      areaSp: selectedTender?.area_sp || 0,
    });
  };

  // Фильтрация данных
  const filteredData = filterCostData(data, searchText);

  // Получаем выбранный тендер для отображения area_sp
  const selectedTender = tenders.find(t => t.id === selectedTenderId);

  // Обработчик выбора тендера из карточек
  const handleTenderSelect = (tenderId: string, title: string, version: number) => {
    setSelectedTenderTitle(title);
    setSelectedVersion(version);
    setSelectedTenderId(tenderId);
  };

  // Обработчик возврата к выбору тендера
  const handleBackToSelection = () => {
    setSelectedTenderId(null);
    setSelectedTenderTitle(null);
    setSelectedVersion(null);
    setData([]);
  };

  // Если тендер не выбран, показываем компонент выбора
  if (!selectedTenderId) {
    return (
      <TenderSelection
        tenders={tenders}
        selectedTenderTitle={selectedTenderTitle}
        selectedVersion={selectedVersion}
        getTenderTitles={getTenderTitles}
        getVersionsForTitle={getVersionsForTitle}
        onTenderTitleChange={handleTenderTitleChange}
        onVersionChange={handleVersionChange}
        onTenderSelect={handleTenderSelect}
        shouldFilterArchived={shouldFilterArchived}
      />
    );
  }

  const costTable = (fitToScreen: boolean) => (
    <CostTable
      data={filteredData}
      viewMode={effectiveViewMode}
      loading={loading}
      expandedRowKeys={expandedRowKeys}
      onExpandedRowsChange={setExpandedRowKeys}
      onVolumeChange={handleVolumeChange}
      onNotesChange={handleNotesChange}
      onCategoryClick={(record) => {
        if (record.detail_cost_category_id) {
          setModalCategory({
            id: record.detail_cost_category_id,
            detailName: record.detail_category_name,
            categoryName: record.cost_category_name,
          });
        }
      }}
      areaSp={selectedTender?.area_sp || 0}
      readOnly={readOnly}
      fitToScreen={fitToScreen}
      isPhone={isPhone}
    />
  );

  return (
    <div style={{ margin: isPhone ? '-16px 0' : '-16px', padding: isPhone ? 8 : 24, height: isPhoneDevice ? 'auto' : 'calc(100vh - 64px)' }}>
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}
          onClick={handleBackToSelection}
        >
          ← Назад к выбору тендера
        </Button>
      </div>

      {!isPhoneDevice && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'baseline', gap: 16 }}>
          {selectedTender?.area_sp && (
            <Text type="secondary">
              Площадь объекта по СП: <Text strong>{selectedTender.area_sp.toLocaleString('ru-RU')} м²</Text>
            </Text>
          )}
        </div>
      )}

      <div style={{ marginBottom: 8, display: 'flex', alignItems: isPhone ? 'stretch' : 'center', gap: isPhone ? 8 : 16, flexWrap: 'wrap', flexDirection: isPhone ? 'column' : 'row' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: isPhone ? '100%' : 'auto' }}>
          <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>Тендер:</Text>
          <Select
            style={{ width: isPhone ? undefined : 300, flex: isPhone ? 1 : undefined, minWidth: 0 }}
            placeholder="Выберите тендер"
            value={selectedTenderTitle}
            onChange={handleTenderTitleChange}
            loading={loading}
            options={getTenderTitles()}
            showSearch
            optionFilterProp="children"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </div>
        {selectedTenderTitle && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: isPhone ? '50%' : 'auto' }}>
            <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>Версия:</Text>
            <Select
              style={{ width: isPhone ? undefined : 150, flex: isPhone ? 1 : undefined, minWidth: 0 }}
              placeholder="Выберите версию"
              value={selectedVersion}
              onChange={handleVersionChange}
              options={getVersionsForTitle(selectedTenderTitle)}
            />
          </div>
        )}
      </div>

      <Card bordered={false} styles={{ body: { padding: 0 } }} style={{ height: isPhoneDevice ? 'auto' : 'calc(100% - 140px)' }}>
        <div style={{ padding: isPhone ? '8px 8px 0' : '24px 24px 0' }}>
          <CostFilters
            costType={costType}
            viewMode={effectiveViewMode}
            searchText={searchText}
            onCostTypeChange={setCostType}
            onViewModeChange={(v) => { setViewMode(v); setViewModeTouched(true); }}
            onSearchChange={setSearchText}
            onExpandAll={() => {
              // Рекурсивно собираем ключи всех строк с детьми (над-группа +
              // вложенные категории + локации), иначе ВИС-категории внутри
              // над-группы «ВНУТРЕННИЕ ИНЖЕНЕРНЫЕ СИСТЕМЫ» не раскроются.
              const collectKeys = (rows: typeof filteredData): string[] =>
                rows.flatMap(row =>
                  row.children && row.children.length > 0
                    ? [row.key, ...collectKeys(row.children)]
                    : [],
                );
              setExpandedRowKeys(collectKeys(filteredData));
            }}
            onCollapseAll={() => setExpandedRowKeys([])}
            onExport={handleExport}
            disableExport={!selectedTenderId || filteredData.length === 0}
          />
        </div>

        {isLandscapePhone ? (
          <LandscapeTableOverlay
            theme={currentTheme}
            fit="width"
            width={COST_TABLE_FIT_WIDTH[effectiveViewMode]}
            footer={
              <CostTotalsBar
                totals={computeCostTotals(filteredData)}
                viewMode={effectiveViewMode}
                areaSp={selectedTender?.area_sp || 0}
              />
            }
          >
            {costTable(true)}
          </LandscapeTableOverlay>
        ) : (
          costTable(false)
        )}
      </Card>

      <CategoryPositionsModal
        open={!!modalCategory}
        tenderId={selectedTenderId}
        category={modalCategory}
        onClose={() => setModalCategory(null)}
      />
    </div>
  );
};

export default ConstructionCostNew;
