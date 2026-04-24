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

function applyDeltasToBase(
  base: AdjustmentBaseRow[],
  deltas: Map<string, number>
): AdjustmentBaseRow[] {
  if (deltas.size === 0) return base;
  return base.map((row) => {
    const delta = deltas.get(row.position_id);
    return delta ? { ...row, total_works_after: row.total_works_after + delta } : row;
  });
}

function cumulativeDeltas(
  base: AdjustmentBaseRow[],
  rules: PositionAdjustmentRule[]
): { cumulative: Map<string, number>; current: AdjustmentBaseRow[] } {
  const cumulative = new Map<string, number>();
  let state = base;
  for (const rule of rules) {
    const { deltas } = calculatePositionAdjustment(rule, state);
    if (deltas.size === 0) continue;
    for (const [id, value] of deltas) {
      cumulative.set(id, (cumulative.get(id) ?? 0) + value);
    }
    state = applyDeltasToBase(state, deltas);
  }
  return { cumulative, current: state };
}

export interface UsePositionAdjustmentReturn {
  draft: Draft;
  appliedRules: PositionAdjustmentRule[];
  appliedDeltas: Map<string, number>;
  currentBaseRows: AdjustmentBaseRow[];
  previewDeltas: Map<string, number>;
  previewErrors: PositionAdjustmentValidationError[];
  setMode: (mode: PositionAdjustmentMode) => void;
  setAmount: (amount: number) => void;
  setSourceIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setTargetIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  apply: () => PositionAdjustmentValidationError[];
  removeIteration: (index: number) => void;
  reset: () => void;
  hydrate: (rules: PositionAdjustmentRule[]) => void;
}

export function usePositionAdjustment(
  baseRows: AdjustmentBaseRow[]
): UsePositionAdjustmentReturn {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('transfer'));
  const [appliedRules, setAppliedRules] = useState<PositionAdjustmentRule[]>([]);

  const { cumulative: appliedDeltas, current: currentBaseRows } = useMemo(
    () => cumulativeDeltas(baseRows, appliedRules),
    [baseRows, appliedRules]
  );

  const setMode = useCallback((mode: PositionAdjustmentMode) => {
    setDraft((prev) => ({
      mode,
      amount: prev.amount,
      sourceIds: mode === 'add' ? new Set() : new Set(prev.sourceIds),
      targetIds: mode === 'deduct' ? new Set() : new Set(prev.targetIds),
    }));
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

  // Ленивый preview: пересчёт дельт идёт с низким приоритетом, сам input отзывчив.
  const deferredDraftRule = useDeferredValue(draftRule);
  const deferredCurrentBaseRows = useDeferredValue(currentBaseRows);

  const preview = useMemo(
    () => calculatePositionAdjustment(deferredDraftRule, deferredCurrentBaseRows),
    [deferredDraftRule, deferredCurrentBaseRows]
  );

  const apply = useCallback((): PositionAdjustmentValidationError[] => {
    const errors = validatePositionAdjustment(draftRule, currentBaseRows);
    if (errors.length === 0) {
      setAppliedRules((prev) => [...prev, draftRule]);
      setDraft((prev) => ({
        mode: prev.mode,
        amount: 0,
        sourceIds: new Set(),
        targetIds: new Set(),
      }));
    }
    return errors;
  }, [draftRule, currentBaseRows]);

  const removeIteration = useCallback((index: number) => {
    setAppliedRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const reset = useCallback(() => {
    setAppliedRules([]);
    setDraft(emptyDraft('transfer'));
  }, []);

  const hydrate = useCallback((rules: PositionAdjustmentRule[]) => {
    setAppliedRules(rules);
    setDraft(emptyDraft('transfer'));
  }, []);

  return {
    draft,
    appliedRules,
    appliedDeltas,
    currentBaseRows,
    previewDeltas: preview.deltas,
    previewErrors: preview.errors,
    setMode,
    setAmount,
    setSourceIds,
    setTargetIds,
    apply,
    removeIteration,
    reset,
    hydrate,
  };
}
