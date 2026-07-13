import React, { useState, useEffect } from 'react';
import { Form, Tabs, App, Alert } from 'antd';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';
import type { TabKey } from './types';
import { useTactics } from './hooks/useTactics';
import { useMarkupParameters } from './hooks/useMarkupParameters';
import { usePricingDistribution } from './hooks/usePricingDistribution';
import { useStepBuilderState } from './hooks/useStepBuilderState';
import { TacticsList } from './components/TacticsList';
import { TacticEditor } from './components/TacticEditor';
import { SequenceTab } from './components/SequenceTab';
import { BasePercentagesTab } from './components/BasePercentagesTab';
import { ParametersTab } from './components/ParametersTab';
import { PricingTab } from './components/PricingTab';
import './MarkupConstructor.css';

// Конструктор наценок. Логика разнесена по hooks/* (тактики, параметры,
// ценообразование, конструктор шагов), UI — по components/*, расчёты и
// формулы — по utils/*. Здесь остаются selection-state и композиция вкладок.

const MarkupConstructor: React.FC = () => {
  const [form] = Form.useForm();
  const { modal } = App.useApp();
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTacticId, setSelectedTacticId] = useState<string | null>(null); // Выбранная тактика в селекте
  const [activeTab, setActiveTab] = useState<TabKey>('works');
  const [basePercentagesForm] = Form.useForm();
  const [newParameterForm] = Form.useForm();

  const parameters = useMarkupParameters({ form, basePercentagesForm, newParameterForm, modal });

  const pricing = usePricingDistribution({ selectedTenderId, selectedTacticId });

  const tacticsState = useTactics({
    form,
    markupParameters: parameters.markupParameters,
    selectedTenderId,
    setSelectedTenderId,
    setSelectedTacticId,
    fetchPricingDistribution: pricing.fetchPricingDistribution,
  });

  const builder = useStepBuilderState({
    markupSequences: tacticsState.markupSequences,
    setMarkupSequences: tacticsState.setMarkupSequences,
  });

  // Значение процента наценки — из основной формы (как в исходнике).
  const getPercent = (key: string | number) => form.getFieldValue(key) || 0;

  // Загрузка списка тендеров и тактик
  useEffect(() => {
    tacticsState.fetchTenders();
    tacticsState.fetchTactics();
    parameters.fetchMarkupParameters(); // Загружаем параметры наценок
    // initial fetch on mount; stable hook-returned functions excluded intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native WS hub — общий список тактик (topic `markup`). Обновляет только
  // список; открытый редактор последовательности не трогаем.
  useRealtimeTopic('markup', () => {
    void tacticsState.fetchTactics();
  });

  const renderSequenceTab = (tabKey: TabKey) => (
    <SequenceTab
      tabKey={tabKey}
      markupSequences={tacticsState.markupSequences}
      baseCosts={tacticsState.baseCosts}
      setBaseCosts={tacticsState.setBaseCosts}
      markupParameters={parameters.markupParameters}
      getPercent={getPercent}
      builder={builder}
    />
  );

  return (
    <div style={{ minHeight: '100%', overflow: 'visible' }} className="markup-constructor">
      <Tabs
        defaultActiveKey="tactics"
        items={[
          {
            key: 'tactics',
            label: 'Порядок применения наценок',
            children: (
              <div style={{ minHeight: '100%', overflow: 'visible' }}>
                {!tacticsState.isTacticSelected ? (
                  // Список схем наценок
                  <TacticsList
                    tactics={tacticsState.tactics}
                    loadingTactics={tacticsState.loadingTactics}
                    tacticSearchText={tacticsState.tacticSearchText}
                    setTacticSearchText={tacticsState.setTacticSearchText}
                    onSelectTactic={(tacticId) => {
                      tacticsState.handleTacticChange(tacticId);
                      tacticsState.setIsTacticSelected(true);
                    }}
                    onCreateNew={tacticsState.handleCreateNewTactic}
                  />
                ) : (
                  // Редактор схемы наценок
                  <>
                  {tacticsState.sequenceErrors.length > 0 && (
                    <Alert
                      type="error"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="Нельзя сохранить: исправьте последовательность наценок"
                      description={
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {tacticsState.sequenceErrors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      }
                    />
                  )}
                  <TacticEditor
                    tactics={tacticsState.tactics}
                    currentTacticId={tacticsState.currentTacticId}
                    currentTacticName={tacticsState.currentTacticName}
                    isEditingName={tacticsState.isEditingName}
                    editingName={tacticsState.editingName}
                    setEditingName={tacticsState.setEditingName}
                    onStartEditingName={tacticsState.handleStartEditingName}
                    onSaveName={tacticsState.handleSaveName}
                    onCancelEditingName={tacticsState.handleCancelEditingName}
                    onBackToList={tacticsState.handleBackToList}
                    onSaveTactic={tacticsState.handleSaveTactic}
                    performDeleteTactic={tacticsState.performDeleteTactic}
                    performCopyTactic={tacticsState.performCopyTactic}
                    markupParameters={parameters.markupParameters}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    renderSequenceTab={renderSequenceTab}
                  />
                  </>
                )}
              </div>
            ),
          },
          {
            key: 'base_percentages',
            label: 'Базовые проценты',
            children: (
              <BasePercentagesTab
                basePercentagesForm={basePercentagesForm}
                markupParameters={parameters.markupParameters}
                loadingParameters={parameters.loadingParameters}
                savingBasePercentages={parameters.savingBasePercentages}
                onSave={parameters.handleSaveBasePercentages}
                onReset={parameters.handleResetBasePercentages}
              />
            ),
          },
          {
            key: 'parameters',
            label: 'Управление параметрами',
            children: (
              <ParametersTab
                markupParameters={parameters.markupParameters}
                editingParameterId={parameters.editingParameterId}
                editingParameterLabel={parameters.editingParameterLabel}
                setEditingParameterLabel={parameters.setEditingParameterLabel}
                onInlineEdit={parameters.handleInlineEdit}
                onInlineSave={parameters.handleInlineSave}
                onInlineCancel={parameters.handleInlineCancel}
                onDeleteParameter={parameters.handleDeleteParameter}
                onMoveParameterUp={parameters.handleMoveParameterUp}
                onMoveParameterDown={parameters.handleMoveParameterDown}
                isAddParameterModalOpen={parameters.isAddParameterModalOpen}
                newParameterForm={newParameterForm}
                onAddParameter={parameters.handleAddParameter}
                onOpenParameterModal={parameters.handleOpenParameterModal}
                onCloseParameterModal={parameters.handleCloseParameterModal}
              />
            ),
          },
          {
            key: 'pricing',
            label: 'Ценообразование',
            children: (
              <PricingTab
                tenders={tacticsState.tenders}
                selectedTenderId={selectedTenderId}
                onTenderChange={tacticsState.handleTenderChange}
                pricingDistribution={pricing.pricingDistribution}
                loadingPricing={pricing.loadingPricing}
                savingPricing={pricing.savingPricing}
                onDistributionChange={pricing.handleDistributionChange}
                onSave={pricing.handleSavePricingDistribution}
                onReset={pricing.handleResetPricingToDefaults}
              />
            ),
          },
        ]}
      />
    </div>
  );
};

export default MarkupConstructor;
