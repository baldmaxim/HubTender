export type PositionAdjustmentMode = 'deduct' | 'transfer' | 'add';

export interface PositionAdjustmentRule {
  mode: PositionAdjustmentMode;
  amount: number;
  sourceIds: string[];
  targetIds: string[];
}

export interface PositionAdjustmentValidationError {
  code:
    | 'amount_required'
    | 'source_required'
    | 'target_required'
    | 'amount_exceeds_source'
    | 'source_target_overlap';
  message: string;
}
