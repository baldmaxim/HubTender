/**
 * Страница перераспределения стоимости работ
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, message } from 'antd';
import { supabase } from '../../lib/supabase';
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
import { smartRoundResults } from './utils';
import { buildResultRows } from './utils/buildResultRows';
import { TabPositionAdjustment } from './components/PositionAdjustment/TabPositionAdjustment';
import type { PositionAdjustmentRule } from './types/positionAdjustment';

const AUTOSAVE_DEBOUNCE_MS = 800;
const SAVED_TAG_DURATION_MS = 2000;

const CostRedistribution: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState('setup');
  const [insuranceTotal, setInsuranceTotal] = useState(0);
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

  // Формируем Map для быстрого доступа к BOQ элементам
  const boqItemsMap = useMemo(() => {
    const map = new Map<string, (typeof boqItems)[number]>();
    for (const item of boqItems) {
      map.set(item.id, item);
    }
    return map;
  }, [boqItems]);

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

  const preparedResults = useMemo(() => {
    if (!hasAnyRedistribution || categoryLevelRows.length === 0) {
      return null;
    }

    // Apply position-adjustment deltas on top of categoryLevelRows instead of
    // rebuilding from clientPositions/boqItemsByPosition — buildResultRows
    // is O(positions × boqItemsPerPosition), calling it twice per render was
    // the biggest hot spot on large tenders (see plan H1).
    const adjustedRows = adjustment.appliedDeltas.size === 0
      ? categoryLevelRows
      : categoryLevelRows.map((row) => {
          const delta = adjustment.appliedDeltas.get(row.position_id) ?? 0;
          if (delta === 0) return row;
          const adjustedWorksAfter = row.total_works_after + delta;
          const q = row.quantity || 1;
          return {
            ...row,
            total_works_after: adjustedWorksAfter,
            work_unit_price_after: adjustedWorksAfter / q,
            redistribution_amount: row.redistribution_amount + delta,
          };
        });

    const roundedRows = smartRoundResults(adjustedRows);
    const totalWorksBase = roundedRows.reduce(
      (sum, row) => sum + (row.rounded_total_works ?? row.total_works_after),
      0
    );

    const rows =
      insuranceTotal > 0 && totalWorksBase > 0
        ? roundedRows.map((row) => {
            const worksAfter = row.rounded_total_works ?? row.total_works_after;
            const insuranceShare = insuranceTotal * (worksAfter / totalWorksBase);
            const newWorks = worksAfter + insuranceShare;

            return {
              ...row,
              rounded_total_works: newWorks,
              rounded_work_unit_price_after: newWorks / (row.quantity || 1),
            };
          })
        : roundedRows;

    const totals = rows.reduce(
      (acc, row) => {
        acc.totalMaterials += row.rounded_total_materials ?? row.total_materials;
        acc.totalWorks += row.rounded_total_works ?? row.total_works_after;
        return acc;
      },
      {
        totalMaterials: 0,
        totalWorks: 0,
        total: 0,
      }
    );

    totals.total = totals.totalMaterials + totals.totalWorks;

    return {
      rows,
      totals,
    };
  }, [
    hasAnyRedistribution,
    categoryLevelRows,
    insuranceTotal,
    adjustment.appliedDeltas,
  ]);

  // Загрузка страхования от судимостей при смене тендера
  useEffect(() => {
    if (!selectedTenderId) { setInsuranceTotal(0); return; }
    supabase
      .from('tender_insurance')
      .select('judicial_pct, total_pct, apt_price_m2, apt_area, parking_price_m2, parking_area, storage_price_m2, storage_area')
      .eq('tender_id', selectedTenderId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) { setInsuranceTotal(0); return; }
        const apt = (data.apt_price_m2 || 0) * (data.apt_area || 0);
        const park = (data.parking_price_m2 || 0) * (data.parking_area || 0);
        const stor = (data.storage_price_m2 || 0) * (data.storage_area || 0);
        setInsuranceTotal(
          (apt + park + stor) * ((data.judicial_pct || 0) / 100) * ((data.total_pct || 0) / 100)
        );
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
        return;
      }

      try {
        const savedData = await loadSavedResults(selectedTenderId, selectedTacticId);

        if (savedData && savedData.results.length > 0) {

          // Восстановить результаты
          const results = savedData.results.map(item => ({
            boq_item_id: item.boq_item_id,
            original_work_cost: item.original_work_cost,
            deducted_amount: item.deducted_amount,
            added_amount: item.added_amount,
            final_work_cost: item.final_work_cost,
          }));
          setResults(results);

          // Восстановить rules и targets из первой записи (все имеют одинаковые правила)
          const redistributionRules = savedData.redistributionRules;
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

          // Переключить на вкладку результатов
          setActiveTab('results');
          message.success('Загружены сохраненные результаты');
        } else {
          // Очистить при отсутствии данных
          clearRules();
          clearTargets();
          clearResults();
          adjustment.reset();
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
      const calculationResult = calculate();
      if (!calculationResult) {
        return;
      }

      // При пересчёте category-level сбрасываем position-level, чтобы не применять
      // старое правило к новой базе (source/target могут уже не соответствовать).
      adjustment.reset();

      setActiveTab('results');

      void saveResults(
        selectedTenderId,
        selectedTacticId,
        calculationResult.results,
        sourceRules,
        targetCosts,
        []
      );
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
    sourceRules,
    targetCosts,
  ]);

  const handleClear = useCallback(() => {
    clearRules();
    clearTargets();
    clearResults();
    adjustment.reset();
  }, [clearRules, clearTargets, clearResults, adjustment]);

  const handleExport = useCallback(() => {
    if (!selectedTenderId) {
      return;
    }

    const selectedTender = tenders.find((t) => t.id === selectedTenderId);

    if (!selectedTender) {
      return;
    }

    import('./utils/exportToExcel').then(({ exportRedistributionToExcel }) => {
      exportRedistributionToExcel({
        clientPositions,
        redistributionResults: calculationState.results,
        boqItemsMap,
        tenderTitle: `${selectedTender.title} (v${selectedTender.version})`,
        insuranceTotal,
        positionAdjustmentDeltas: adjustment.appliedDeltas,
      });
    });
  }, [
    selectedTenderId,
    tenders,
    clientPositions,
    calculationState.results,
    boqItemsMap,
    insuranceTotal,
    adjustment.appliedDeltas,
  ]);

  const handleSavePositionAdjustment = useCallback(async () => {
    if (!selectedTenderId || !selectedTacticId) {
      return;
    }
    // Placeholder для случая «position-level без category-level»:
    // схема cost_redistribution_results требует NOT NULL boq_item_id, а JSONB-правила
    // храним на любой реальной строке тендера. Чтобы она не искажала суммы при reload,
    // передаём её реальный total_commercial_work_cost.
    const first = boqItems[0];
    const fallbackBoqItem = first
      ? { id: first.id, total_commercial_work_cost: first.total_commercial_work_cost ?? 0 }
      : undefined;
    if (calculationState.results.length === 0 && !fallbackBoqItem) {
      return;
    }
    const ok = await saveResults(
      selectedTenderId,
      selectedTacticId,
      calculationState.results,
      sourceRules,
      targetCosts,
      adjustment.appliedRules,
      fallbackBoqItem
    );
    if (ok) {
      setSavedRecently(true);
    }
  }, [
    selectedTenderId,
    selectedTacticId,
    boqItems,
    calculationState.results,
    sourceRules,
    targetCosts,
    adjustment.appliedRules,
    saveResults,
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
        items={tabItems}
        activeKey={activeTab}
        onChange={setActiveTab}
      />
    </div>
  );
};

export default CostRedistribution;
