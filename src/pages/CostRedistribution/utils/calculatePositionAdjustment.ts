import type {
  PositionAdjustmentRule,
  PositionAdjustmentValidationError,
} from '../types/positionAdjustment';

export interface AdjustmentBaseRow {
  position_id: string;
  total_works_after: number;
}

export interface PositionAdjustmentComputation {
  deltas: Map<string, number>;
  errors: PositionAdjustmentValidationError[];
}

const EPSILON = 0.01;

export function validatePositionAdjustment(
  rule: PositionAdjustmentRule,
  baseRows: AdjustmentBaseRow[]
): PositionAdjustmentValidationError[] {
  const errors: PositionAdjustmentValidationError[] = [];

  if (!(rule.amount > 0)) {
    errors.push({ code: 'amount_required', message: 'Введите сумму больше нуля' });
  }

  const needSource = rule.mode === 'deduct' || rule.mode === 'transfer';
  const needTarget = rule.mode === 'add' || rule.mode === 'transfer';

  if (needSource && rule.sourceIds.length === 0) {
    errors.push({ code: 'source_required', message: 'Выберите строки в блоке «Откуда»' });
  }

  if (needTarget && rule.targetIds.length === 0) {
    errors.push({ code: 'target_required', message: 'Выберите строки в блоке «Куда»' });
  }

  if (rule.mode === 'transfer') {
    const sourceSet = new Set(rule.sourceIds);
    const hasOverlap = rule.targetIds.some((id) => sourceSet.has(id));
    if (hasOverlap) {
      errors.push({
        code: 'source_target_overlap',
        message: 'Одна и та же строка не может быть одновременно источником и получателем',
      });
    }
  }

  if (needSource && rule.amount > 0 && rule.sourceIds.length > 0) {
    const baseById = new Map(baseRows.map((row) => [row.position_id, row.total_works_after]));
    const totalSource = rule.sourceIds.reduce(
      (sum, id) => sum + Math.max(0, baseById.get(id) ?? 0),
      0
    );
    if (rule.amount - totalSource > EPSILON) {
      errors.push({
        code: 'amount_exceeds_source',
        message: `Сумма вычета ${rule.amount.toFixed(2)} превышает итог работ выбранных строк ${totalSource.toFixed(2)}`,
      });
    }
  }

  return errors;
}

export function calculatePositionAdjustment(
  rule: PositionAdjustmentRule,
  baseRows: AdjustmentBaseRow[]
): PositionAdjustmentComputation {
  const errors = validatePositionAdjustment(rule, baseRows);
  const deltas = new Map<string, number>();

  if (errors.length > 0 || rule.amount <= 0) {
    return { deltas, errors };
  }

  const baseById = new Map(baseRows.map((row) => [row.position_id, row.total_works_after]));

  const applyProportional = (ids: string[], sign: 1 | -1) => {
    const total = ids.reduce((sum, id) => sum + Math.max(0, baseById.get(id) ?? 0), 0);
    if (total <= 0) return;
    for (const id of ids) {
      const share = Math.max(0, baseById.get(id) ?? 0) / total;
      const delta = sign * rule.amount * share;
      deltas.set(id, (deltas.get(id) ?? 0) + delta);
    }
  };

  if (rule.mode === 'deduct' || rule.mode === 'transfer') {
    applyProportional(rule.sourceIds, -1);
  }
  if (rule.mode === 'add' || rule.mode === 'transfer') {
    applyProportional(rule.targetIds, 1);
  }

  return { deltas, errors: [] };
}
