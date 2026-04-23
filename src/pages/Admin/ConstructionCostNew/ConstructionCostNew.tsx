/**
 * Страница "Затраты на строительство" (новая версия)
 * Отображение и редактирование объемов затрат по категориям с расчетом стоимостей
 */

import React, { useState } from 'react';
import { Button, Space, Typography, Select, Card } from 'antd';
import { useCostData } from './hooks/useCostData';
import CostFilters from './components/CostFilters';
import CostTable from './components/CostTable';
import TenderSelection from './components/TenderSelection';
import { exportConstructionCostToExcel } from './utils/exportConstructionCostToExcel';
import { filterCostData } from './utils/filterCostData';
import { useAuth } from '../../../contexts/AuthContext';

const { Title, Text } = Typography;

const ConstructionCostNew: React.FC = () => {
  const { user } = useAuth();
  const [searchText, setSearchText] = useState('');
  const [viewMode, setViewMode] = useState<'detailed' | 'summary' | 'simplified'>('detailed');
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);

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
    fetchConstructionCosts,
    handleVolumeChange,
  } = useCostData();

  // Проверка роли для фильтрации архивных тендеров в карточках
  const shouldFilterArchived = user?.role_code === 'engineer' || user?.role_code === 'moderator';

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

  return (
    <div style={{ margin: '-16px', padding: '24px', height: 'calc(100vh - 64px)' }}>
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}
          onClick={handleBackToSelection}
        >
          ← Назад к выбору тендера
        </Button>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          Затраты на строительство
        </Title>
        {selectedTender?.area_sp && (
          <Text type="secondary">
            Площадь объекта по СП: <Text strong>{selectedTender.area_sp.toLocaleString('ru-RU')} м²</Text>
          </Text>
        )}
      </div>

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Space size="small">
          <Text type="secondary">Тендер:</Text>
          <Select
            style={{ width: 300 }}
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
        </Space>
        {selectedTenderTitle && (
          <Space size="small">
            <Text type="secondary">Версия:</Text>
            <Select
              style={{ width: 150 }}
              placeholder="Выберите версию"
              value={selectedVersion}
              onChange={handleVersionChange}
              options={getVersionsForTitle(selectedTenderTitle)}
            />
          </Space>
        )}
      </div>

      <Card bordered={false} style={{ height: 'calc(100% - 140px)' }}>
        <CostFilters
          costType={costType}
          viewMode={viewMode}
          searchText={searchText}
          onCostTypeChange={setCostType}
          onViewModeChange={setViewMode}
          onSearchChange={setSearchText}
          onExpandAll={() => {
            const allKeys = filteredData.filter(row => row.is_category).map(row => row.key);
            setExpandedRowKeys(allKeys);
          }}
          onCollapseAll={() => setExpandedRowKeys([])}
          onRefresh={fetchConstructionCosts}
          onExport={handleExport}
          disableExport={!selectedTenderId || filteredData.length === 0}
        />

        <CostTable
          data={filteredData}
          viewMode={viewMode}
          loading={loading}
          expandedRowKeys={expandedRowKeys}
          onExpandedRowsChange={setExpandedRowKeys}
          onVolumeChange={handleVolumeChange}
          areaSp={selectedTender?.area_sp || 0}
        />
      </Card>
    </div>
  );
};

export default ConstructionCostNew;
