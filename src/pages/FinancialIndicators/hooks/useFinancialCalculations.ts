import { useState, useCallback, useRef } from 'react';
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
import type { CurrencyType } from '../../../lib/types';
import type { IndicatorRow } from '../types';
import { aggregateDirectCosts } from '../utils/aggregateDirectCosts';
import { extractSequenceParams, resolveMarkupCoefficients } from '../utils/markupCoefficients';
import { computeIndicators } from '../utils/computeIndicators';
import { buildIndicatorRows } from '../utils/buildIndicatorRows';
import { getFiDiscounts, type FiDiscountSettings } from '../../../lib/api/fiDiscounts';
import {
  buildDiscountWorkspace,
  type DiscountWorkspace,
  type BuildWorkspaceInput,
} from '../discount/utils/buildWorkspace';
import { applyDiscountRules } from '../discount/utils/applyDiscount';
import type { DiscountContext } from '../discount/types';

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

/**
 * Настройки снижения. Единственный доп. запрос на обычном пути — по нему и
 * определяется, включено ли снижение вообще. Сбой не должен ронять страницу:
 * падаем в «выключено», то есть в исходное поведение.
 */
const loadDiscountSettings = async (tenderId: string): Promise<FiDiscountSettings> => {
  try {
    return await getFiDiscounts(tenderId);
  } catch (error) {
    console.error('Ошибка загрузки настроек снижения:', error);
    return { enabled: false, rules: [] };
  }
};

export const useFinancialCalculations = () => {
  const [loading, setLoading] = useRealtimeAwareLoading(false);
  const [data, setData] = useState<IndicatorRow[]>([]);
  const [spTotal, setSpTotal] = useState<number>(0);
  const [customerTotal, setCustomerTotal] = useState<number>(0);
  const [isVatInConstructor, setIsVatInConstructor] = useState<boolean>(false);
  const [vatCoefficient, setVatCoefficient] = useState<number>(0);
  // Fail-closed: валюты без курса → показатели не рассчитываются, Alert/«—».
  const [fxMissing, setFxMissing] = useState<CurrencyType[]>([]);
  // Снижение: null — выключено или не настроено, страница считает как обычно.
  const [discountContext, setDiscountContext] = useState<DiscountContext | null>(null);
  const [discountSettings, setDiscountSettings] = useState<FiDiscountSettings | null>(null);

  // Сырые входы последней загрузки. Нужны, чтобы вкладка «Снижение» могла
  // построить рабочее пространство, не перезагружая boq_items (десятки тысяч
  // строк), и чтобы обычный путь расчёта не платил за это ничего.
  const rawInputsRef = useRef<BuildWorkspaceInput | null>(null);
  const workspaceRef = useRef<{ tenderId: string; workspace: DiscountWorkspace } | null>(null);

  /**
   * Рабочее пространство снижения для текущего тендера (ленивое, с кэшем).
   * Зовётся из пайплайна при enabled=true и из вкладки «Снижение» при открытии.
   *
   * `expectedTenderId` защищает от гонки при переключении тендера: вкладка может
   * дёрнуть хелпер раньше, чем пайплайн обновит rawInputsRef, и без проверки
   * получила бы рабочее пространство предыдущего тендера.
   */
  const getDiscountWorkspace = useCallback(async (
    expectedTenderId?: string,
  ): Promise<DiscountWorkspace | null> => {
    const raw = rawInputsRef.current;
    if (!raw) return null;
    if (expectedTenderId && raw.tenderId !== expectedTenderId) return null;
    const cached = workspaceRef.current;
    if (cached && cached.tenderId === raw.tenderId) return cached.workspace;
    const workspace = await buildDiscountWorkspace(raw);
    workspaceRef.current = { tenderId: raw.tenderId, workspace };
    return workspace;
  }, []);

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
      const totalsResult = aggregateDirectCosts(boqItems, tender, exclusions);

      // Fail-closed: нет курса → не считаем показатели, показываем «—»/Alert.
      if (totalsResult.value === null) {
        setFxMissing(totalsResult.missingCurrencies);
        setData([]);
        setSpTotal(0);
        setCustomerTotal(0);
        // Сводку снижения тоже гасим: без курсов «Было/Стало» показывать нечего.
        setDiscountContext(null);
        rawInputsRef.current = null;
        workspaceRef.current = null;
        return;
      }
      setFxMissing([]);
      const totals = totalsResult.value;

      const areaSp = tender?.area_sp || 0;
      const areaClient = tender?.area_client || 0;

      // Разрешение коэффициентов наценок + признак «НДС в конструкторе»
      const coeffs = resolveMarkupCoefficients(tenderMarkupPercentages, sequenceParams);
      setVatCoefficient(coeffs.vatCoeff);
      setIsVatInConstructor(coeffs.isVatInConstructor);

      // Сырые входы кладём до ветки со снижением: вкладка «Снижение» должна
      // уметь построить рабочее пространство и когда тумблер выключен.
      rawInputsRef.current = { tenderId: selectedTenderId, tender, boqItems, exclusions, coeffs };
      if (workspaceRef.current && workspaceRef.current.tenderId !== selectedTenderId) {
        workspaceRef.current = null;
      }

      // Снижение — опционально. Выключено или правил нет → ниже идёт ровно тот
      // же путь, что и до появления механизма: никаких доп. загрузок и правок
      // в числах.
      const settings = await loadDiscountSettings(selectedTenderId);
      setDiscountSettings(settings);

      let calcTotals = totals;
      let discount: DiscountContext | null = null;

      if (settings.enabled && settings.rules.length > 0) {
        const workspace = await getDiscountWorkspace();
        if (workspace) {
          const applied = applyDiscountRules(totals, settings.rules, workspace.reducibles, workspace.multipliers);
          calcTotals = applied.reducedTotals;
          const { alphaByPosition } = applied;
          discount = {
            baseGrandTotal: computeIndicators(totals, coeffs, insuranceCost, { quiet: true }).grandTotal,
            reducedGrandTotal: 0, // проставляется ниже, когда посчитан основной каскад
            appliedAmount: applied.appliedAmount,
            alphaByPosition,
            errorsByRule: applied.errorsByRule,
            itemScale: (positionId, boqItemType, materialType) => {
              if (!positionId) return 1;
              const alpha = alphaByPosition.get(positionId);
              if (!alpha) return 1;
              // Нереснижаемые элементы (база основных материалов) не масштабируем —
              // ровно как в самом расчёте снижения.
              return workspace.isReducible(boqItemType, materialType) ? 1 - alpha : 1;
            },
          };
        }
      }

      // Формульный расчёт всех промежуточных значений и итогов
      const calc = computeIndicators(calcTotals, coeffs, insuranceCost);

      if (discount) {
        discount.reducedGrandTotal = calc.grandTotal;
      }
      setDiscountContext(discount);

      // Сборка строк таблицы (включая НДС-умножение строк 1-16)
      const tableData = buildIndicatorRows(calc, calcTotals, coeffs, insuranceData, areaSp, areaClient);

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
  }, [setLoading, getDiscountWorkspace]);

  return {
    data,
    spTotal,
    customerTotal,
    loading,
    isVatInConstructor,
    vatCoefficient,
    fxMissing,
    fetchFinancialIndicators,
    // Снижение
    discountContext,
    discountSettings,
    getDiscountWorkspace,
  };
};
