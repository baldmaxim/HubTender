import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import type {
  PositionAdjustmentMode,
  PositionAdjustmentRule,
  PositionAdjustmentValidationError,
} from '../types/positionAdjustment';
import {
  calculatePositionAdjustment,
  validatePositionAdjustment,
  type AdjustmentBaseRow,
} from '../utils/calculatePositionAdjustment';

interface Draft {
  mode: PositionAdjustmentMode;
  amount: number;
  sourceIds: Set<string>;
  targetIds: Set<string>;
}

function emptyDraft(mode: PositionAdjustmentMode = 'transfer'): Draft {
  return { mode, amount: 0, sourceIds: new Set(), targetIds: new Set() };
}

export interface UsePositionAdjustmentReturn {
  draft: Draft;
  appliedRule: PositionAdjustmentRule | null;
  appliedDeltas: Map<string, number>;
  previewDeltas: Map<string, number>;
  previewErrors: PositionAdjustmentValidationError[];
  setMode: (mode: PositionAdjustmentMode) => void;
  setAmount: (amount: number) => void;
  setSourceIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setTargetIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  apply: () => PositionAdjustmentValidationError[];
  reset: () => void;
  hydrate: (rule: PositionAdjustmentRule) => void;
}

export function usePositionAdjustment(
  baseRows: AdjustmentBaseRow[]
): UsePositionAdjustmentReturn {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('transfer'));
  const [appliedRule, setAppliedRule] = useState<PositionAdjustmentRule | null>(null);

  const setMode = useCallback((mode: PositionAdjustmentMode) => {
    setDraft((prev) => {
      const next: Draft = {
        mode,
        amount: prev.amount,
        sourceIds: mode === 'add' ? new Set() : new Set(prev.sourceIds),
        targetIds: mode === 'deduct' ? new Set() : new Set(prev.targetIds),
      };
      return next;
    });
  }, []);

  const setAmount = useCallback((amount: number) => {
    setDraft((prev) => ({ ...prev, amount: Number.isFinite(amount) ? amount : 0 }));
  }, []);

  const setSourceIds = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setDraft((prev) => ({
        ...prev,
        sourceIds:
          typeof updater === 'function'
            ? (updater as (p: Set<string>) => Set<string>)(new Set(prev.sourceIds))
            : new Set(updater),
      }));
    },
    []
  );

  const setTargetIds = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setDraft((prev) => ({
        ...prev,
        targetIds:
          typeof updater === 'function'
            ? (updater as (p: Set<string>) => Set<string>)(new Set(prev.targetIds))
            : new Set(updater),
      }));
    },
    []
  );

  const draftRule = useMemo<PositionAdjustmentRule>(
    () => ({
      mode: draft.mode,
      amount: draft.amount,
      sourceIds: Array.from(draft.sourceIds),
      targetIds: Array.from(draft.targetIds),
    }),
    [draft]
  );

  // Ленивый preview: пока пользователь быстро вводит сумму, ввод остаётся отзывчивым,
  // а пересчёт дельт по тысячам строк идёт в фоновом приоритете.
  const deferredDraftRule = useDeferredValue(draftRule);
  const deferredBaseRows = useDeferredValue(baseRows);

  const preview = useMemo(
    () => calculatePositionAdjustment(deferredDraftRule, deferredBaseRows),
    [deferredDraftRule, deferredBaseRows]
  );

  const appliedDeltas = useMemo(() => {
    if (!appliedRule) {
      return new Map<string, number>();
    }
    return calculatePositionAdjustment(appliedRule, baseRows).deltas;
  }, [appliedRule, baseRows]);

  const apply = useCallback((): PositionAdjustmentValidationError[] => {
    const errors = validatePositionAdjustment(draftRule, baseRows);
    if (errors.length === 0) {
      setAppliedRule(draftRule);
    }
    return errors;
  }, [draftRule, baseRows]);

  const reset = useCallback(() => {
    setAppliedRule(null);
    setDraft(emptyDraft('transfer'));
  }, []);

  const hydrate = useCallback((rule: PositionAdjustmentRule) => {
    setAppliedRule(rule);
    setDraft({
      mode: rule.mode,
      amount: rule.amount,
      sourceIds: new Set(rule.sourceIds),
      targetIds: new Set(rule.targetIds),
    });
  }, []);

  return {
    draft,
    appliedRule,
    appliedDeltas,
    previewDeltas: preview.deltas,
    previewErrors: preview.errors,
    setMode,
    setAmount,
    setSourceIds,
    setTargetIds,
    apply,
    reset,
    hydrate,
  };
}
