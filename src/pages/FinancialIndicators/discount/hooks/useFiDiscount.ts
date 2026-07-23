import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { saveFiDiscounts, type FiDiscountRule, type FiDiscountSettings } from '../../../../lib/api/fiDiscounts';
import { markRealtimeMutation } from '../../../../lib/realtime/useRealtimeRefetch';
import { getErrorMessage } from '../../../../utils/errors';
import { emptyDirectCostTotals } from '../../utils/aggregateDirectCosts';
import type { DiscountWorkspace } from '../utils/buildWorkspace';
import {
  applyDiscountRules,
  reducibleCapacity,
  validateDiscountRule,
} from '../utils/applyDiscount';
import type { FiDiscountValidationError } from '../types';

interface UseFiDiscountArgs {
  tenderId: string;
  /** Сохранённые настройки тендера (источник истины после каждой загрузки страницы). */
  settings: FiDiscountSettings | null;
  /** Ленивая сборка рабочего пространства — зовём при открытии вкладки и смене тендера. */
  getDiscountWorkspace: (expectedTenderId?: string) => Promise<DiscountWorkspace | null>;
  /** Дёргается после успешного сохранения, чтобы страница пересчитала показатели. */
  onSaved: () => void;
}

const EMPTY_SETTINGS: FiDiscountSettings = { enabled: false, rules: [] };

export function useFiDiscount({
  tenderId,
  settings,
  getDiscountWorkspace,
  onSaved,
}: UseFiDiscountArgs) {
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<FiDiscountRule[]>([]);
  const [amount, setAmount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [workspace, setWorkspace] = useState<DiscountWorkspace | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Гидратация из сохранённых настроек.
  //
  // Сверяемся по ССЫЛКЕ на settings, а не только по dirty: сразу после save()
  // dirty гаснет, но страница ещё не успела перезагрузиться, и без этой проверки
  // мы бы откатили UI к досохранённому состоянию до прихода свежих данных.
  // Локальные правки при этом всегда в приоритете — иначе realtime-эхо
  // собственной записи сбрасывало бы набранную итерацию.
  const lastHydratedRef = useRef<FiDiscountSettings | null | undefined>(undefined);
  useEffect(() => {
    if (settings === lastHydratedRef.current) return;
    if (dirty) return;
    lastHydratedRef.current = settings;
    const next = settings ?? EMPTY_SETTINGS;
    setEnabled(next.enabled);
    setRules(next.rules);
  }, [settings, dirty]);

  // settings в зависимостях намеренно: его ссылка обновляется после каждой
  // загрузки страницы, а значит и после того, как пайплайн положил сырые входы
  // нового тендера — к этому моменту рабочее пространство уже можно собирать.
  useEffect(() => {
    let cancelled = false;
    setLoadingWorkspace(true);
    getDiscountWorkspace(tenderId)
      .then((ws) => {
        if (!cancelled) setWorkspace(ws);
      })
      .catch((error) => {
        console.error('Ошибка подготовки данных снижения:', error);
        if (!cancelled) setWorkspace(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkspace(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getDiscountWorkspace, tenderId, settings]);

  // Состояние ПОСЛЕ уже применённых итераций — от него считаются остатки,
  // потолок для новой итерации и подсветка строк.
  //
  // База намеренно нулевая: здесь нужны только alphaByPosition и errorsByRule,
  // reducedTotals (он уйдёт в минус) не используется — прямые затраты тендера
  // считает пайплайн страницы.
  const applied = useMemo(() => {
    if (!workspace) return null;
    return applyDiscountRules(
      emptyDirectCostTotals(),
      rules,
      workspace.reducibles,
      workspace.multipliers,
    );
  }, [workspace, rules]);

  const appliedAlpha = useMemo(
    () => applied?.alphaByPosition ?? new Map<string, number>(),
    [applied],
  );

  // Предпросмотр отзывчив к вводу: сам input не ждёт пересчёта потолка.
  const deferredAmount = useDeferredValue(amount);
  const deferredSelectedIds = useDeferredValue(selectedIds);

  const preview = useMemo(() => {
    if (!workspace) {
      return { capacity: 0, errors: [] as FiDiscountValidationError[] };
    }
    const capacity = reducibleCapacity(deferredSelectedIds, workspace.reducibles, appliedAlpha);
    const errors =
      deferredAmount > 0 && deferredSelectedIds.size > 0
        ? validateDiscountRule(
            { amount: deferredAmount, positionIds: Array.from(deferredSelectedIds) },
            workspace.reducibles,
            appliedAlpha,
          )
        : [];
    return { capacity, errors };
  }, [workspace, deferredSelectedIds, deferredAmount, appliedAlpha]);

  const totalDiscount = useMemo(
    () => rules.reduce((sum, rule) => sum + rule.amount, 0),
    [rules],
  );

  const applyIteration = useCallback(() => {
    if (!workspace) return;
    const rule: FiDiscountRule = { amount, positionIds: Array.from(selectedIds) };
    const errors = validateDiscountRule(rule, workspace.reducibles, appliedAlpha);
    if (errors.length > 0) {
      message.warning(errors[0].message);
      return;
    }
    setRules((prev) => [...prev, rule]);
    setAmount(0);
    setSelectedIds(new Set());
    setDirty(true);
  }, [workspace, amount, selectedIds, appliedAlpha]);

  const removeIteration = useCallback((index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  const resetIterations = useCallback(() => {
    setRules([]);
    setAmount(0);
    setSelectedIds(new Set());
    setDirty(true);
  }, []);

  const toggleEnabled = useCallback((next: boolean) => {
    setEnabled(next);
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await saveFiDiscounts(tenderId, { enabled, rules });
      // Подавляем self-echo: запись породит NOTIFY → WS-эхо в этой же вкладке.
      markRealtimeMutation(`tender:${tenderId}`);
      setDirty(false);
      message.success('Настройки снижения сохранены');
      onSaved();
    } catch (error) {
      message.error('Не удалось сохранить снижение: ' + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [tenderId, enabled, rules, onSaved]);

  return {
    enabled,
    rules,
    amount,
    selectedIds,
    workspace,
    loadingWorkspace,
    saving,
    dirty,
    appliedAlpha,
    previewCapacity: preview.capacity,
    previewErrors: preview.errors,
    totalDiscount,
    setAmount,
    setSelectedIds,
    toggleEnabled,
    applyIteration,
    removeIteration,
    resetIterations,
    save,
  };
}
