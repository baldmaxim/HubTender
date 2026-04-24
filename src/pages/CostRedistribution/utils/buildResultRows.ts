import type { ClientPosition } from '../hooks';
import type { RedistributionResult } from './calculateDistribution';
import type { ResultRow } from '../components/Results/ResultsTableColumns';

export function buildResultRows(
  clientPositions: ClientPosition[],
  boqItemsByPosition: Map<string, Array<{
    id: string;
    client_position_id: string;
    total_commercial_work_cost: number;
    total_commercial_material_cost: number;
  }>>,
  resultsMap: Map<string, RedistributionResult>,
  positionAdjustments?: Map<string, number>
): ResultRow[] {
  const regularPositions = clientPositions.filter((position) => !position.is_additional);
  const additionalPositions = clientPositions.filter((position) => position.is_additional);

  const additionalByParent = new Map<string, ClientPosition[]>();
  for (const position of additionalPositions) {
    if (!position.parent_position_id) {
      continue;
    }

    const siblings = additionalByParent.get(position.parent_position_id);
    if (siblings) {
      siblings.push(position);
    } else {
      additionalByParent.set(position.parent_position_id, [position]);
    }
  }

  const isLeafPosition = (index: number, positions: ClientPosition[]): boolean => {
    if (index === positions.length - 1) {
      return true;
    }

    const currentLevel = positions[index].hierarchy_level || 0;
    const nextLevel = positions[index + 1]?.hierarchy_level || 0;
    return currentLevel >= nextLevel;
  };

  const createResultRow = (
    position: ClientPosition,
    index: number,
    positions: ClientPosition[]
  ): ResultRow => {
    const positionBoqItems = boqItemsByPosition.get(position.id) ?? [];

    let totalMaterials = 0;
    let totalWorksBefore = 0;
    let totalWorksAfter = 0;
    let totalRedistribution = 0;

    for (const boqItem of positionBoqItems) {
      const materialCost = boqItem.total_commercial_material_cost || 0;
      if (materialCost > 0) {
        totalMaterials += materialCost;
      }

      const workCost = boqItem.total_commercial_work_cost || 0;
      if (workCost <= 0) {
        continue;
      }

      const result = resultsMap.get(boqItem.id);
      if (result) {
        totalWorksBefore += result.original_work_cost;
        totalWorksAfter += result.final_work_cost;
        totalRedistribution += result.added_amount - result.deducted_amount;
      } else {
        totalWorksBefore += workCost;
        totalWorksAfter += workCost;
      }
    }

    const positionDelta = positionAdjustments?.get(position.id) ?? 0;
    const adjustedWorksAfter = totalWorksAfter + positionDelta;
    const adjustedRedistribution = totalRedistribution + positionDelta;

    const quantity = position.manual_volume || position.volume || 1;

    return {
      key: position.id,
      position_id: position.id,
      position_number: position.position_number,
      section_number: position.section_number,
      position_name: position.position_name,
      item_no: position.item_no,
      work_name: position.work_name,
      client_volume: position.volume,
      manual_volume: position.manual_volume,
      unit_code: position.unit_code,
      quantity,
      material_unit_price: totalMaterials / quantity,
      work_unit_price_before: totalWorksBefore / quantity,
      work_unit_price_after: adjustedWorksAfter / quantity,
      total_materials: totalMaterials,
      total_works_before: totalWorksBefore,
      total_works_after: adjustedWorksAfter,
      redistribution_amount: adjustedRedistribution,
      manual_note: position.manual_note,
      isLeaf: isLeafPosition(index, positions),
      is_additional: position.is_additional,
    };
  };

  const rows: ResultRow[] = [];

  for (let index = 0; index < regularPositions.length; index += 1) {
    const position = regularPositions[index];
    rows.push(createResultRow(position, index, regularPositions));

    const additionalRows = additionalByParent.get(position.id) ?? [];
    for (const additionalRow of additionalRows) {
      rows.push(createResultRow(additionalRow, 0, [additionalRow]));
    }
  }

  return rows;
}
