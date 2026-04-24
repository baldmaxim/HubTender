/**
 * Parsing Excel file for tender version matching.
 *
 * Expected columns:
 * 0 - item_no
 * 1 - hierarchy_level
 * 2 - work_name
 * 3 - unit_code
 * 4 - volume
 * 5 - client_note
 */

import * as XLSX from 'xlsx';
import type { ParsedRow } from './matching';
import { getErrorMessage } from './errors';

export interface ParseExcelResult {
  positions: ParsedRow[];
  errors: string[];
  warnings: string[];
}

export interface ParseOptions {
  skipFirstRow?: boolean;
  validateUnits?: boolean;
}

function hasCellValue(cell: unknown): boolean {
  if (cell === undefined || cell === null) {
    return false;
  }

  if (typeof cell === 'string') {
    return cell.trim() !== '';
  }

  return true;
}

function parseNullableNumber(cell: unknown): number | null {
  if (!hasCellValue(cell)) {
    return null;
  }

  const parsed = Number(cell);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function parseExcelForVersion(
  file: File,
  options: ParseOptions = {}
): Promise<ParseExcelResult> {
  const { skipFirstRow = true } = options;

  const result: ParseExcelResult = {
    positions: [],
    errors: [],
    warnings: [],
  };

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1 });
    const rows = skipFirstRow ? jsonData.slice(1) : jsonData;

    rows.forEach((row: unknown, index: number) => {
      if (!Array.isArray(row) || row.length === 0) {
        return;
      }

      if (!row.some(cell => hasCellValue(cell))) {
        return;
      }

      const cells = row as unknown[];
      const rowNumber = skipFirstRow ? index + 2 : index + 1;

      try {
        const parsedRow: ParsedRow = {
          item_no: hasCellValue(cells[0]) ? String(cells[0]).trim() : '',
          hierarchy_level: hasCellValue(cells[1]) ? Number(cells[1]) : 0,
          work_name: hasCellValue(cells[2]) ? String(cells[2]).trim() : '',
          unit_code: hasCellValue(cells[3]) ? String(cells[3]).trim() : '',
          volume: parseNullableNumber(cells[4]),
          client_note: hasCellValue(cells[5]) ? String(cells[5]).trim() : '',
        };

        if (!parsedRow.work_name) {
          result.errors.push(`Строка ${rowNumber}: отсутствует наименование работы`);
          return;
        }

        if (!parsedRow.item_no) {
          result.warnings.push(`Строка ${rowNumber}: отсутствует номер раздела`);
        }

        if (!parsedRow.unit_code) {
          result.warnings.push(`Строка ${rowNumber}: отсутствует единица измерения`);
        }

        if (parsedRow.volume === 0) {
          result.warnings.push(`Строка ${rowNumber}: количество равно 0`);
        }

        result.positions.push(parsedRow);
      } catch (error) {
        result.errors.push(`Строка ${rowNumber}: ошибка парсинга - ${getErrorMessage(error)}`);
      }
    });

    if (result.positions.length === 0 && result.errors.length === 0) {
      result.errors.push('Файл не содержит данных или все строки пустые');
    }
  } catch (error) {
    result.errors.push(`Ошибка чтения файла: ${getErrorMessage(error)}`);
  }

  return result;
}

export function validateParsedPositions(positions: ParsedRow[]): string[] {
  const errors: string[] = [];
  const nameMap = new Map<string, number[]>();

  positions.forEach((pos, idx) => {
    const name = pos.work_name.toLowerCase();
    if (!nameMap.has(name)) {
      nameMap.set(name, []);
    }
    nameMap.get(name)!.push(idx + 1);
  });

  nameMap.forEach((indices, name) => {
    if (indices.length > 1) {
      errors.push(`Дубликат наименования "${name}" в строках: ${indices.join(', ')}`);
    }
  });

  positions.forEach((pos, idx) => {
    if (pos.hierarchy_level < 0 || pos.hierarchy_level > 10) {
      errors.push(`Строка ${idx + 1}: некорректный уровень иерархии (${pos.hierarchy_level})`);
    }
  });

  return errors;
}

export function getParseStatistics(positions: ParsedRow[]) {
  const uniqueSections = new Set(positions.map(p => p.item_no).filter(Boolean));
  const uniqueUnits = new Set(positions.map(p => p.unit_code).filter(Boolean));

  const hierarchyLevels = positions.reduce((acc, pos) => {
    acc[pos.hierarchy_level] = (acc[pos.hierarchy_level] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const totalVolume = positions.reduce((sum, pos) => sum + (pos.volume ?? 0), 0);

  return {
    totalPositions: positions.length,
    uniqueSections: uniqueSections.size,
    uniqueUnits: uniqueUnits.size,
    hierarchyLevels,
    totalVolume,
  };
}
