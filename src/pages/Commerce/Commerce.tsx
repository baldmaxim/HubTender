/**
 * Страница "Коммерция" - отображение коммерческих стоимостей позиций заказчика
 */

import { Card, Spin, Empty, Alert, message } from 'antd';
import { useEffect, useRef, useMemo, useCallback } from 'react';
import { missingFXMessage } from '../../utils/boq/currencyGuard';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWorkspaceTabActions } from '../../contexts/WorkspaceTabsContext';
import { buildPositionTabPath } from '../../lib/cache/workspaceTabsStorage';
import { setRow as seedPositionRow } from '../../lib/cache/positionRowCache';
import { useCommerceData, useCommerceActions } from './hooks';
import { TenderSelector, CommerceTable, CommerceCards, CommerceHeader, COMMERCE_TABLE_FIT_WIDTH } from './components';
import CommerceTotalsBar from './components/CommerceTotalsBar';
import { exportCommerceToExcel } from './utils/exportToExcel';
import { resolveFinancialCalculationState, LAST_CALCULATED_TOTAL_LABEL } from '../../lib/financial/calculationState';
import { computeCommerceTotals } from './utils/computeCommerceTotals';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useTheme } from '../../contexts/ThemeContext';
import { LandscapeTableOverlay } from '../../components/responsive/LandscapeTableOverlay';

export default function Commerce() {
  const navigate = useNavigate();
  // См. handleNavigateToPosition: navigate пересоздаётся на каждую навигацию — держим в ref,
  // чтобы обработчик оставался стабильным пропом для мемоизированного CommerceCards.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const location = useLocation();
  // Под keep-alive страница остаётся смонтированной, когда открыта вкладка позиции
  // (WorkspaceKeepAlive скрывает через display:none, а не размонтирует). URL — источник
  // истины активной вкладки; Commerce рендерится только на этом якоре.
  const isTabActive = location.pathname === '/commerce/proposal';
  const { openPositionTab } = useWorkspaceTabActions();
  const { isPhone, isLandscapePhone } = useIsMobile();
  const { theme: currentTheme } = useTheme();
  // Архивные тендеры отображаются в фильтре для всех пользователей
  const shouldFilterArchived = false;
  const lastAutoRefreshAtRef = useRef(0);

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
    boqItems,
    markupTactics,
    selectedTacticId,
    tacticChanged,
    setTacticChanged,
    loadTenders,
    loadPositions,
    handleTacticChange,
    syncTenderMarkupTactic,
    referenceTotal,
    insuranceTotal,
    redistributionState,
    distributeToRows,
  } = useCommerceData(isTabActive);

  // Когда распределение по строкам выключено — страхование не показываем на
  // «Форме КП» вообще (ни в строках, ни в итогах/сводке): оно учитывается только
  // в итоге «Финансовых показателей». При включённом флаге — полная сумма.
  const effInsurance = distributeToRows ? insuranceTotal : 0;

  const {
    handleApplyTactic
  } = useCommerceActions(
    selectedTenderId,
    selectedTacticId,
    setCalculating,
    setTacticChanged,
    syncTenderMarkupTactic,
    loadTenders,
    loadPositions
  );
  // Примечание: realtime-обновление таблицы КП после серверного авто-пересчёта
  // живёт в useCommerceData (useRealtimeTopic('tender:<id>') → loadPositions),
  // поэтому отдельная подписка здесь не нужна.

  useEffect(() => {
    const refreshIfNeeded = () => {
      // Скрытая вкладка не рефетчит: под keep-alive эти слушатели живут и пока пользователь
      // работает во вкладке позиции, и тянули бы весь loadPositions ей в конкуренты.
      if (!isTabActive || !selectedTenderId || loading || calculating) {
        return;
      }

      const now = Date.now();
      if (now - lastAutoRefreshAtRef.current < 1000) {
        return;
      }

      lastAutoRefreshAtRef.current = now;
      void loadPositions(selectedTenderId);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIfNeeded();
      }
    };

    const handleFocus = () => {
      refreshIfNeeded();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isTabActive, selectedTenderId, loading, calculating, loadPositions]);

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

  // Обработка экспорта в Excel
  const handleExportToExcel = () => {
    const selectedTender = tenders.find(t => t.id === selectedTenderId);
    // Fail-closed: нет курса → не выгружаем частичные значения.
    const fxMsg = selectedTender
      ? missingFXMessage(boqItems ?? [], {
          usd_rate: selectedTender.usd_rate,
          eur_rate: selectedTender.eur_rate,
          cny_rate: selectedTender.cny_rate,
        })
      : null;
    if (fxMsg) {
      message.error(fxMsg);
      return;
    }
    // 0-F2: экспорт «Коммерции» содержит финальные финансовые суммы — при
    // неактуальном расчёте файл не создаётся (никаких сумм под видом final).
    if (!financialState.canExportFinal) {
      message.error(
        `${financialState.alertMessage ?? 'Финансовый расчёт не актуален.'} Финальный экспорт недоступен (FINANCIAL_CALCULATION_NOT_READY).`,
      );
      return;
    }
    // Этап 0.1.2.3b.1: при requires_recalculation snapshot существует, но
    // устарел/неполон — экспорт содержал бы базовые значения под видом final.
    // Файл НЕ создаётся (REDISTRIBUTION_RECALCULATION_REQUIRED). При
    // not_configured экспорт — явный base-export без перераспределения.
    if (redistributionState.exportBlockedCode === 'REDISTRIBUTION_RECALCULATION_REQUIRED') {
      message.error(
        `${redistributionState.alert ?? 'Расчёт перераспределения устарел или неполон. Выполните пересчёт.'} (REDISTRIBUTION_RECALCULATION_REQUIRED)`,
      );
      return;
    }
    exportCommerceToExcel(positions, selectedTender, effInsurance, distributeToRows);
  };

  // Единый Alert об отсутствующем курсе валюты (P0): считаем по загруженным
  // boq_items текущего тендера. Бэкенд остаётся окончательным блокером.
  const fxWarning = useMemo(() => {
    if (loading || !boqItems) return null;
    const tender = tenders.find(t => t.id === selectedTenderId);
    if (!tender) return null;
    return missingFXMessage(boqItems, {
      usd_rate: tender.usd_rate,
      eur_rate: tender.eur_rate,
      cny_rate: tender.cny_rate,
    });
  }, [loading, boqItems, tenders, selectedTenderId]);

  // 0-F2: единая политика статуса финансового расчёта — final-export гейт.
  const financialState = useMemo(
    () => resolveFinancialCalculationState(tenders.find(t => t.id === selectedTenderId)),
    [tenders, selectedTenderId],
  );

  // Навигация к позиции — открываем внутренней вкладкой приложения (keep-alive), «Форма КП»
  // остаётся смонтированной вкладкой и сохраняет состояние.
  //
  // useCallback + navigateRef: обработчик уходит пропом в мемоизированный CommerceCards, а
  // react-router пересоздаёт navigate на каждую навигацию — без ref идентичность обработчика
  // менялась бы и пробивала memo, обнуляя смысл мемоизации списка.
  const handleNavigateToPosition = useCallback((positionId: string) => {
    if (!selectedTenderId) return;
    // Сеем строку в positionRowCache ПЕРЕД навигацией: useBoqItems гидратирует из него шапку
    // синхронно, иначе PositionItems вернёт скелетон на весь round-trip /with-tender.
    // Именно setRow, а НЕ setRows([row]): setRows всегда зовёт pruneExpired — полный скан
    // localStorage с JSON.parse каждой записи, и в обработчике клика это залипание перед
    // переходом (регрессия, из-за которой залипли ОБЕ страницы, включая быстрые «Позиции»).
    const row = positions.find((p) => p.id === positionId);
    if (row) seedPositionRow(row);
    openPositionTab({ positionId, tenderId: selectedTenderId, title: 'Позиция' });
    navigateRef.current(buildPositionTabPath(positionId, selectedTenderId));
  }, [selectedTenderId, positions, openPositionTab]);

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
      styles={{ body: { padding: isPhone ? '8px 0' : 0 } }}
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
          onTenderTitleChange={handleTenderTitleChange}
          onVersionChange={handleVersionChange}
          onTacticChange={handleTacticChange}
          onApplyTactic={handleApplyTactic}
          onExport={handleExportToExcel}
          shouldFilterArchived={shouldFilterArchived}
        />
      }
    >
      {fxWarning && (
        <Alert type="error" showIcon message={fxWarning} style={{ marginBottom: 12 }} />
      )}
      {financialState.alertMessage && (
        <Alert
          type={financialState.alertType ?? 'warning'}
          showIcon
          message={financialState.alertMessage}
          description={financialState.totalsAreLastCalculated ? `Суммы ниже — ${LAST_CALCULATED_TOTAL_LABEL.toLowerCase()}.` : undefined}
          style={{ marginBottom: 12 }}
        />
      )}
      {redistributionState.alert && (
        <Alert
          type="warning"
          showIcon
          message={redistributionState.alert}
          description="Показаны значения ДО перераспределения — они не являются финальным расчётом."
          style={{ marginBottom: 12 }}
        />
      )}
      {selectedTenderId ? (
        <Spin spinning={loading || calculating}>
          {isPhone ? (
            <CommerceCards
              positions={positions}
              selectedTenderId={selectedTenderId}
              onNavigateToPosition={handleNavigateToPosition}
              insuranceTotal={effInsurance}
              distributeToRows={distributeToRows}
            />
          ) : isLandscapePhone ? (
            <LandscapeTableOverlay
              theme={currentTheme}
              fit="width"
              width={COMMERCE_TABLE_FIT_WIDTH}
              footer={
                <CommerceTotalsBar
                  totals={computeCommerceTotals(positions, effInsurance, referenceTotal)}
                  insuranceTotal={effInsurance}
                />
              }
            >
              <CommerceTable
                positions={positions}
                selectedTenderId={selectedTenderId}
                onNavigateToPosition={handleNavigateToPosition}
                referenceTotal={referenceTotal}
                insuranceTotal={effInsurance}
                distributeToRows={distributeToRows}
                fitToScreen
              />
            </LandscapeTableOverlay>
          ) : (
            <CommerceTable
              positions={positions}
              selectedTenderId={selectedTenderId}
              onNavigateToPosition={handleNavigateToPosition}
              referenceTotal={referenceTotal}
              insuranceTotal={effInsurance}
              distributeToRows={distributeToRows}
            />
          )}
        </Spin>
      ) : (
        <Empty description="Выберите тендер для просмотра коммерческих стоимостей" />
      )}
    </Card>
  );
}
