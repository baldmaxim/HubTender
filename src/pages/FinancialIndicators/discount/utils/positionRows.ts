import type { PositionWithCostsRow } from '../../../../lib/api/positions';
import type { PositionReducible } from '../types';

/** Строка таблицы выбора на вкладке «Снижение». */
export interface DiscountPositionRow {
  key: string;
  positionId: string;
  positionNumber: number;
  itemNo: string | null;
  workName: string;
  isAdditional: boolean;
  isLeaf: boolean;
  /** Исходная стоимость, доступная к снижению. */
  reducible: number;
  /** Уже снято применёнными итерациями. */
  alreadyReduced: number;
}

/**
 * Раздел или лист. Позиция считается листом, когда следующая по списку не
 * глубже неё — та же логика, что в buildResultRows на Перераспределении.
 */
const isLeafPosition = (index: number, positions: PositionWithCostsRow[]): boolean => {
  if (index === positions.length - 1) return true;
  const currentLevel = positions[index].hierarchy_level || 0;
  const nextLevel = positions[index + 1]?.hierarchy_level || 0;
  return currentLevel >= nextLevel;
};

export const buildDiscountPositionRows = (
  positions: PositionWithCostsRow[],
  reducibles: Map<string, PositionReducible>,
  appliedAlpha: Map<string, number>,
): DiscountPositionRow[] =>
  positions.map((position, index) => {
    const reducible = reducibles.get(position.id)?.commercial ?? 0;
    const alpha = appliedAlpha.get(position.id) ?? 0;
    return {
      key: position.id,
      positionId: position.id,
      positionNumber: position.position_number,
      itemNo: position.item_no,
      workName: position.work_name,
      isAdditional: Boolean(position.is_additional),
      isLeaf: isLeafPosition(index, positions),
      reducible,
      alreadyReduced: reducible * alpha,
    };
  });

/** Строка таблицы выбора на вкладке «Обнуление» (полная стоимость строки). */
export interface ZeroingPositionRow {
  key: string;
  positionId: string;
  positionNumber: number;
  itemNo: string | null;
  workName: string;
  isAdditional: boolean;
  isLeaf: boolean;
  /** Полная коммерческая стоимость строки (уйдёт при обнулении). */
  commercial: number;
}

export const buildZeroingPositionRows = (
  positions: PositionWithCostsRow[],
  commercialByPosition: Map<string, number>,
): ZeroingPositionRow[] =>
  positions.map((position, index) => ({
    key: position.id,
    positionId: position.id,
    positionNumber: position.position_number,
    itemNo: position.item_no,
    workName: position.work_name,
    isAdditional: Boolean(position.is_additional),
    isLeaf: isLeafPosition(index, positions),
    commercial: commercialByPosition.get(position.id) ?? 0,
  }));
