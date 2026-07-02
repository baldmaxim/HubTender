import { useState, useCallback } from 'react';
import { useRealtimeAwareLoading } from '../../../lib/realtime/useRealtimeAwareLoading';
import {
  getTenderById,
  tryGetMarkupTactic,
  getTenderInsuranceFI,
  listAllBoqItemsForTender,
  listSubcontractGrowthExclusions,
  type BoqItemWithPosition,
} from '../../../lib/api/fi';
import { listTenderMarkupPercentages } from '../../../lib/api/markup';
import { createSystemNotification } from '../../../lib/api/notifications';
import { getErrorMessage } from '../../../utils/errors';
import { computeInsuranceTotal } from '../../../services/redistributionPipeline';
import type { IndicatorRow } from '../types';
import { aggregateDirectCosts } from '../utils/aggregateDirectCosts';
import { extractSequenceParams, resolveMarkupCoefficients } from '../utils/markupCoefficients';
import { computeIndicators } from '../utils/computeIndicators';
import { buildIndicatorRows } from '../utils/buildIndicatorRows';

// Обратная совместимость: IndicatorRow переехал в ../types.ts,
// useFinancialData и компоненты продолжают импортировать его отсюда.
export type { IndicatorRow } from '../types';

const addNotification = async (
  title: string,
  message: string,
  type: 'success' | 'info' | 'warning' | 'pending' = 'warning',
) => {
  try {
    await createSystemNotification({ title, message, type });
  } catch (error) {
    console.error('Ошибка создания уведомления:', error);
  }
};

export const useFinancialCalculations = () => {
  const [loading, setLoading] = useRealtimeAwareLoading(false);
  const [data, setData] = useState<IndicatorRow[]>([]);
  const [spTotal, setSpTotal] = useState<number>(0);
  const [customerTotal, setCustomerTotal] = useState<number>(0);
  const [isVatInConstructor, setIsVatInConstructor] = useState<boolean>(false);
  const [vatCoefficient, setVatCoefficient] = useState<number>(0);

  const fetchFinancialIndicators = useCallback(async (selectedTenderId: string | null) => {
    if (!selectedTenderId) return;

    setLoading(true);
    try {
      let tender;
      try {
        tender = await getTenderById(selectedTenderId);
      } catch (tenderError) {
        await addNotification(
          'Ошибка загрузки тендера',
          `Не удалось загрузить данные тендера: ${getErrorMessage(tenderError)}`,
          'warning',
        );
        throw tenderError;
      }

      let tactic = null;
      try {
        tactic = await tryGetMarkupTactic(tender.markup_tactic_id ?? null);
      } catch (tacticError) {
        await addNotification(
          'Ошибка загрузки тактики наценок',
          `Не удалось загрузить тактику наценок: ${getErrorMessage(tacticError)}`,
          'warning',
        );
      }

      // Извлечение ключей параметров из JSONB поля sequences тактики наценок
      const sequenceParams = extractSequenceParams(tactic);

      let tenderMarkupPercentages: Awaited<ReturnType<typeof listTenderMarkupPercentages>> | null = null;
      try {
        tenderMarkupPercentages = await listTenderMarkupPercentages(selectedTenderId);
      } catch (percentagesError) {
        await addNotification(
          'Ошибка загрузки процентов наценок',
          `Не удалось загрузить проценты наценок: ${getErrorMessage(percentagesError)}`,
          'warning',
        );
      }

      let insuranceData = null;
      try {
        insuranceData = await getTenderInsuranceFI(selectedTenderId);
      } catch {
        // ignore — fallback to zero insurance cost
      }

      const insuranceCost = computeInsuranceTotal(insuranceData);

      const boqItems: BoqItemWithPosition[] = await listAllBoqItemsForTender(selectedTenderId);

      let exclusions: Awaited<ReturnType<typeof listSubcontractGrowthExclusions>> = [];
      try {
        exclusions = await listSubcontractGrowthExclusions(selectedTenderId);
      } catch {
        exclusions = [];
      }

      // Агрегация прямых затрат по типам BOQ-элементов
      const totals = aggregateDirectCosts(boqItems, tender, exclusions);

      const areaSp = tender?.area_sp || 0;
      const areaClient = tender?.area_client || 0;

      // Разрешение коэффициентов наценок + признак «НДС в конструкторе»
      const coeffs = resolveMarkupCoefficients(tenderMarkupPercentages, sequenceParams);
      setVatCoefficient(coeffs.vatCoeff);
      setIsVatInConstructor(coeffs.isVatInConstructor);

      // Формульный расчёт всех промежуточных значений и итогов
      const calc = computeIndicators(totals, coeffs, insuranceCost);

      // Сборка строк таблицы (включая НДС-умножение строк 1-16)
      const tableData = buildIndicatorRows(calc, totals, coeffs, insuranceData, areaSp, areaClient);

      setData(tableData);
      setSpTotal(areaSp);
      setCustomerTotal(areaClient);
    } catch (error) {
      console.error('Ошибка загрузки показателей:', error);
      await addNotification(
        'Ошибка загрузки финансовых показателей',
        `Не удалось загрузить финансовые показатели: ${error instanceof Error ? error.message : String(error)}`,
        'warning'
      );
    } finally {
      setLoading(false);
    }
  }, [setLoading]);

  return {
    data,
    spTotal,
    customerTotal,
    loading,
    isVatInConstructor,
    vatCoefficient,
    fetchFinancialIndicators,
  };
};
