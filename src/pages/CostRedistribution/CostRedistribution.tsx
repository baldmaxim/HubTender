/**
 * Страница перераспределения стоимости работ
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, message, Alert } from 'antd';
import { formatFXUnavailable } from '../../utils/boq/currencyGuard';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useTheme } from '../../contexts/ThemeContext';
import { loadTenderInsurance } from '../../lib/api/insurance';
import { RedistributionHeader } from './components/RedistributionHeader';
import { TabSetup } from './components/TabSetup';
import { TabResults } from './components/TabResults';
import {
  useSourceRules,
  useTargetCosts,
  useRedistributionData,
  useCostCategories,
  useDistributionCalculator,
  useSaveResults,
  usePositionAdjustment,
} from './hooks';
import { buildResultRows } from './utils/buildResultRows';
// UI preview only: applyRedistributionPipeline здесь используется исключительно
// для локального НЕСОХРАНЁННОГО предпросмотра в редакторе. Авторитетная
// prepared-проекция приходит с сервера (backend/internal/calc) и всегда
// замещает preview после save/load.
import { applyRedistributionPipeline } from '../../services/redistributionPipeline';
import { mapServerPrepared } from './utils/mapServerPrepared';
import { resolveRedistributionConsumptionState } from '../../lib/redistribution/consumptionState';
import { TabPositionAdjustment } from './components/PositionAdjustment/TabPositionAdjustment';
import type { PositionAdjustmentRule } from './types/positionAdjustment';
import type { PreparedServerRedistribution } from '../../lib/api/redistributions';

const AUTOSAVE_DEBOUNCE_MS = 800;
const SAVED_TAG_DURATION_MS = 2000;

const CostRedistribution: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState('setup');
  const { isPhone, isPhoneDevice } = useIsMobile();
  const { theme: currentTheme } = useTheme();
  const [insuranceTotal, setInsuranceTotal] = useState(0);
  // Server prepared projection — единственный авторитетный источник итоговых
  // строк/сумм после save/load. null = показывается локальный preview с
  // явным статусом «не сохранён».
  const [serverPrepared, setServerPrepared] = useState<PreparedServerRedistribution | null>(null);
  const [savedRecently, setSavedRecently] = useState(false);
  const [autosaveNonce, setAutosaveNonce] = useState(0);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);

  // Хуки для управления данными
  const {
    loading,
    tenders,
    selectedTenderId,
    setSelectedTenderId,
    markupTactics,
    selectedTacticId,
    handleTacticChange,
    boqItems,
    clientPositions,
    fxMissing,
  } = useRedistributionData();

  const { categories, detailCategories } = useCostCategories();

  // Создаем Map для быстрого поиска category_id по detail_cost_category_id
  const detailCategoriesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const detail of detailCategories) {
      map.set(detail.id, detail.cost_category_id);
    }
    return map;
  }, [detailCategories]);

  const { sourceRules, addRule, removeRule, clearRules, setRules } = useSourceRules();

  const { targetCosts, addTarget, removeTarget, clearTargets, setTargets } = useTargetCosts();

  const { calculationState, calculate, clearResults, setResults, canCalculate } = useDistributionCalculator(
    boqItems,
    sourceRules,
    targetCosts,
    detailCategoriesMap
  );

  const { saving, saveResults, loadSavedResults } = useSaveResults();

  const boqItemsByPosition = useMemo(() => {
    const map = new Map<string, typeof boqItems>();

    for (const item of boqItems) {
      const existingItems = map.get(item.client_position_id);
      if (existingItems) {
        existingItems.push(item);
      } else {
        map.set(item.client_position_id, [item]);
      }
    }

    return map;
  }, [boqItems]);

  // Формируем Map результатов для быстрого доступа
  const resultsMap = useMemo(() => {
    const map = new Map<string, (typeof calculationState.results)[number]>();
    for (const result of calculationState.results) {
      map.set(result.boq_item_id, result);
    }
    return map;
    // calculationState is a stable hook return; using .results sub-property is intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculationState.results]);

  const categoryLevelRows = useMemo(() => {
    if (clientPositions.length === 0) {
      return [];
    }
    return buildResultRows(clientPositions, boqItemsByPosition, resultsMap);
  }, [clientPositions, boqItemsByPosition, resultsMap]);

  const adjustmentBaseRows = useMemo(
    () =>
      categoryLevelRows.map((row) => ({
        position_id: row.position_id,
        total_works_after: row.total_works_after,
      })),
    [categoryLevelRows]
  );

  const adjustment = usePositionAdjustment(adjustmentBaseRows);

  const hasAnyRedistribution =
    calculationState.results.length > 0 || adjustment.appliedRules.length > 0;

  // Server prepared (после save/load) — авторитет; локальный pipeline — только
  // НЕСОХРАНЁННЫЙ preview в редакторе (isPreview=true → бейдж/блок экспорта).
  const preparedResults = useMemo(() => {
    if (serverPrepared) {
      return { ...mapServerPrepared(serverPrepared), isPreview: false };
    }
    if (!hasAnyRedistribution || categoryLevelRows.length === 0) {
      return null;
    }
    return {
      ...applyRedistributionPipeline({
        categoryLevelRows,
        positionAdjustmentDeltas: adjustment.appliedDeltas,
        insuranceTotal,
      }),
      isPreview: true,
    };
  }, [
    serverPrepared,
    hasAnyRedistribution,
    categoryLevelRows,
    insuranceTotal,
    adjustment.appliedDeltas,
  ]);

  // Загрузка страхования от судимостей при смене тендера (server-computed total)
  useEffect(() => {
    if (!selectedTenderId) { setInsuranceTotal(0); return; }
    loadTenderInsurance(selectedTenderId).then((data) => {
      setInsuranceTotal(data?.insurance_total ?? 0);
    });
  }, [selectedTenderId]);

  // Загрузка сохраненных результатов при выборе тендера и тактики
  useEffect(() => {
    const loadResults = async () => {
      if (!selectedTenderId || !selectedTacticId) {
        // Очистить при сбросе выбора
        clearRules();
        clearTargets();
        clearResults();
        adjustment.reset();
        setServerPrepared(null);
        return;
      }

      try {
        const savedData = await loadSavedResults(selectedTenderId, selectedTacticId);

        if (savedData && savedData.results.length > 0) {
          const isServerSnapshot = savedData.status === 'calculated';

          if (isServerSnapshot) {
            // Server-authoritative снимок — результаты можно применять.
            const results = savedData.results.map(item => ({
              boq_item_id: item.boq_item_id,
              original_work_cost: item.original_work_cost,
              deducted_amount: item.deducted_amount,
              added_amount: item.added_amount,
              final_work_cost: item.final_work_cost,
            }));
            setResults(results);
            setServerPrepared(savedData.prepared ?? null);
          } else {
            // requires_recalculation (legacy / set mismatch / insurance /
            // изменившиеся входы): значения НЕ применяем как авторитетные —
            // восстанавливаем только правила. Сообщение — по reason-коду
            // сервера через единую политику потребления.
            clearResults();
            setServerPrepared(null);
            message.warning(
              resolveRedistributionConsumptionState(
                savedData.status,
                savedData.reason,
                savedData.message,
              ).alert ?? 'Расчёт перераспределения необходимо пересчитать и сохранить на сервере',
            );
          }

          // Восстановить rules и targets (безопасно разобранные правила)
          const redistributionRules = savedData.redistribution_rules;
          if (redistributionRules) {
            if (redistributionRules.deductions) {
              setRules(redistributionRules.deductions);
            }
            if (redistributionRules.targets) {
              setTargets(redistributionRules.targets);
            }
            // Новая форма — массив итераций; legacy — одиночная операция.
            const positionAdjustments = redistributionRules.position_adjustments as
              | PositionAdjustmentRule[]
              | undefined;
            const legacyPositionAdjustment = redistributionRules.position_adjustment as
              | PositionAdjustmentRule
              | undefined;
            if (Array.isArray(positionAdjustments) && positionAdjustments.length > 0) {
              adjustment.hydrate(positionAdjustments);
            } else if (legacyPositionAdjustment && legacyPositionAdjustment.amount > 0) {
              adjustment.hydrate([legacyPositionAdjustment]);
            } else {
              adjustment.reset();
            }
          } else {
            adjustment.reset();
          }

          // Переключить на вкладку результатов только для server-снимка
          if (isServerSnapshot) {
            setActiveTab('results');
            message.success('Загружены сохраненные результаты');
          } else {
            setActiveTab('setup');
          }
        } else {
          // not_configured: перераспределение ещё не рассчитано — нейтральное
          // пустое состояние.
          clearRules();
          clearTargets();
          clearResults();
          adjustment.reset();
          setServerPrepared(null);
          setActiveTab('setup');
        }
      } catch (error) {
        console.error('Ошибка загрузки сохраненных результатов:', error);
      }
    };

    loadResults();
    // adjustment exposes stable callbacks but the full object identity changes each render; avoid cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenderId, selectedTacticId, loadSavedResults, setResults, setRules, setTargets, clearRules, clearTargets, clearResults]);

  // Обработчики
  const handleGoToResults = useCallback(async () => {
    if (!selectedTenderId || !selectedTacticId) {
      message.warning('Выберите тендер и схему наценок');
      return;
    }

    if (!canCalculate) {
      message.warning('Добавьте правила вычитания и целевые затраты');
      return;
    }

    try {
      // Локальный расчёт — только preview/быстрая валидация формы.
      const calculationResult = calculate();
      if (!calculationResult) {
        return;
      }

      // При пересчёте category-level сбрасываем position-level, чтобы не применять
      // старое правило к новой базе (source/target могут уже не соответствовать).
      adjustment.reset();

      // Сервер — источник истины: сохраняются только правила, все результаты
      // считает backend. Успех объявляется ТОЛЬКО по ответу сервера, и
      // локальный preview ПОЛНОСТЬЮ заменяется серверными category+prepared
      // результатами (никакого merge по полям).
      const saved = await saveResults(selectedTenderId, selectedTacticId, sourceRules, targetCosts, []);
      if (!saved) {
        // Save отклонён backend'ом — preview не считается сохранённым;
        // предыдущий подтверждённый server snapshot (serverPrepared) не трогаем.
        return;
      }
      setResults(saved.results);
      setServerPrepared(saved.prepared ?? null);
      setActiveTab('results');
    } catch (error) {
      console.error('Ошибка при переходе к результатам:', error);
      message.error('Не удалось выполнить расчет и сохранение');
    }
  }, [
    selectedTenderId,
    selectedTacticId,
    canCalculate,
    calculate,
    adjustment,
    saveResults,
    setResults,
    sourceRules,
    targetCosts,
  ]);

  const handleClear = useCallback(() => {
    clearRules();
    clearTargets();
    clearResults();
    adjustment.reset();
    setServerPrepared(null);
  }, [clearRules, clearTargets, clearResults, adjustment]);

  const handleExport = useCallback(() => {
    if (!selectedTenderId) {
      return;
    }
    if (fxMissing.length > 0) {
      message.error(formatFXUnavailable(fxMissing));
      return;
    }
    // REDISTRIBUTION_EXPORT_NOT_READY: экспортируются только SERVER prepared
    // строки. Несохранённый preview / legacy snapshot файл не создают.
    if (!serverPrepared || !preparedResults || preparedResults.isPreview) {
      message.error(
        'Экспорт недоступен: расчёт перераспределения не сохранён на сервере (REDISTRIBUTION_EXPORT_NOT_READY)',
      );
      return;
    }

    const selectedTender = tenders.find((t) => t.id === selectedTenderId);

    if (!selectedTender) {
      return;
    }

    import('./utils/exportToExcel').then(({ exportRedistributionToExcel }) => {
      exportRedistributionToExcel({
        rows: preparedResults.rows,
        tenderTitle: `${selectedTender.title} (v${selectedTender.version})`,
      });
    });
  }, [selectedTenderId, tenders, preparedResults, serverPrepared, fxMissing]);

  const handleSavePositionAdjustment = useCallback(async () => {
    if (!selectedTenderId || !selectedTacticId) {
      return;
    }
    // Rules-only команда: никаких results/placeholder/boqItems с клиента.
    // Position-only конфигурация (category-правила пусты) поддерживается
    // сервером нативно — он сам создаёт no-op category-результат.
    if (sourceRules.length === 0 && targetCosts.length === 0 && adjustment.appliedRules.length === 0) {
      return;
    }
    const saved = await saveResults(
      selectedTenderId,
      selectedTacticId,
      sourceRules,
      targetCosts,
      adjustment.appliedRules,
    );
    if (saved) {
      // Серверные category+prepared результаты полностью заменяют preview.
      setResults(saved.results);
      setServerPrepared(saved.prepared ?? null);
      setSavedRecently(true);
    }
  }, [
    selectedTenderId,
    selectedTacticId,
    sourceRules,
    targetCosts,
    adjustment.appliedRules,
    saveResults,
    setResults,
  ]);

  // Сохранение position-level правил с дебаунсом и mutex'ом.
  // - Debounce: даём пользователю ~800 мс «замереть» перед записью.
  // - Mutex (isSavingRef): если save уже в полёте — ставим pendingSaveRef
  //   и после завершения бампаем nonce, чтобы effect перезапустил таймер
  //   со свежим состоянием. Без этого rapid-fire правки приводили бы к гонке
  //   delete+insert и риску «частичных» записей в cost_redistribution_results.
  useEffect(() => {
    if (!selectedTenderId || !selectedTacticId) return;
    if (calculationState.results.length === 0 && boqItems.length === 0) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      if (isSavingRef.current) {
        pendingSaveRef.current = true;
        return;
      }
      isSavingRef.current = true;
      try {
        await handleSavePositionAdjustment();
      } finally {
        isSavingRef.current = false;
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          setAutosaveNonce((n) => n + 1);
        }
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Intentionally exclude boqItems.length / calculationState.results.length:
    // those are already represented by selectedTenderId/selectedTacticId + the
    // state that handleSavePositionAdjustment reads. Including them would cause
    // an extra save on initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustment.appliedRules, selectedTenderId, selectedTacticId, autosaveNonce, handleSavePositionAdjustment]);

  // «Сохранено» бейдж гаснет через 2 сек после завершения сохранения.
  useEffect(() => {
    if (!savedRecently) return;
    const t = window.setTimeout(() => setSavedRecently(false), SAVED_TAG_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [savedRecently]);

  // Элементы вкладок
  const tabItems = [
    {
      key: 'setup',
      label: 'Перераспределение Затрат',
      children: (
        <TabSetup
          categories={categories}
          detailCategories={detailCategories}
          sourceRules={sourceRules}
          targetCosts={targetCosts}
          onAddRule={addRule}
          onRemoveRule={removeRule}
          onAddTarget={addTarget}
          onRemoveTarget={removeTarget}
          totalDeduction={calculationState.totalDeducted}
          canCalculate={canCalculate}
          isCalculated={calculationState.isCalculated}
          saving={saving}
          onGoToResults={handleGoToResults}
          onClear={handleClear}
        />
      ),
    },
    {
      key: 'position-adjustment',
      label: 'Между строками',
      children: (
        <TabPositionAdjustment
          clientPositions={clientPositions}
          baseRows={categoryLevelRows}
          adjustment={adjustment}
        />
      ),
    },
    {
      key: 'results',
      label: 'Таблица результатов',
      children: (
        <TabResults
          rows={preparedResults?.rows ?? []}
          hasResults={hasAnyRedistribution}
          loading={loading}
        />
      ),
    },
  ];

  return (
    <div style={{ padding: '0 8px' }}>
      {fxMissing.length > 0 && (
        <Alert type="error" showIcon message={formatFXUnavailable(fxMissing)} style={{ marginBottom: 12 }} />
      )}
      {preparedResults?.isPreview && (
        <Alert
          type="warning"
          showIcon
          message="Предварительный расчёт — не сохранён"
          description="Показан локальный предпросмотр. Итоговые значения будут рассчитаны сервером при сохранении."
          style={{ marginBottom: 12 }}
        />
      )}
      <RedistributionHeader
        tenders={tenders}
        selectedTenderId={selectedTenderId}
        onTenderChange={setSelectedTenderId}
        markupTactics={markupTactics}
        selectedTacticId={selectedTacticId}
        onTacticChange={handleTacticChange}
        loading={loading}
        totals={preparedResults?.totals}
        insuranceTotal={insuranceTotal}
        hasResults={hasAnyRedistribution}
        onExport={handleExport}
        saving={saving}
        savedRecently={savedRecently}
      />

      <Tabs
        // На телефоне (портрет и ландшафт) оставляем только «Таблицу результатов»;
        // настройка и «Между строками» — только на десктопе/планшете.
        items={isPhoneDevice ? tabItems.filter((t) => t.key === 'results') : tabItems}
        activeKey={isPhoneDevice ? 'results' : activeTab}
        onChange={setActiveTab}
        // На телефоне панель вкладок липкая: при скролле результатов уходит шапка,
        // вкладки закрепляются у верха экрана (скролл-контейнер — Content с overflow:auto).
        renderTabBar={
          isPhone
            ? (tabBarProps, DefaultTabBar) => (
                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    background: currentTheme === 'dark' ? '#141414' : '#ffffff',
                  }}
                >
                  <DefaultTabBar {...tabBarProps} style={{ margin: 0 }} />
                </div>
              )
            : undefined
        }
      />
    </div>
  );
};

export default CostRedistribution;
