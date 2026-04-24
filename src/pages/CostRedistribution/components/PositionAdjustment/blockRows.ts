import type { ResultRow } from '../Results/ResultsTableColumns';

export interface BlockRow {
  key: string;
  position_id: string;
  position_number: number;
  section_number: string | null;
  item_no: string | null;
  work_name: string;
  is_additional: boolean;
  isLeaf: boolean;
  total: number;
  preview_delta: number;
}

export function buildBlockRows(
  baseRows: ResultRow[],
  previewDeltas: Map<string, number>,
  appliedDeltas?: Map<string, number>
): BlockRow[] {
  return baseRows.map((row) => {
    const appliedDelta = appliedDeltas?.get(row.position_id) ?? 0;
    const baseTotal = row.rounded_total_works ?? row.total_works_after;
    return {
      key: row.position_id,
      position_id: row.position_id,
      position_number: row.position_number,
      section_number: row.section_number,
      item_no: row.item_no,
      work_name: row.work_name,
      is_additional: row.is_additional,
      isLeaf: row.isLeaf,
      total: baseTotal + appliedDelta,
      preview_delta: previewDeltas.get(row.position_id) ?? 0,
    };
  });
}
