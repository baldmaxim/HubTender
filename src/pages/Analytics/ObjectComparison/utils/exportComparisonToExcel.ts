/**
 * Утилита экспорта сравнения объектов в Excel
 */

import * as XLSX from 'xlsx-js-style';
import dayjs from 'dayjs';
import { message } from 'antd';
import type { ComparisonRow, CostType } from '../types';

interface ExportParams {
  comparisonData: ComparisonRow[];
  costType: CostType;
  tenderLabels: string[];
}

type RowType = 'header' | 'subheader' | 'category' | 'detail' | 'total';

function flattenRows(data: ComparisonRow[]): { row: ComparisonRow; type: RowType }[] {
  const result: { row: ComparisonRow; type: RowType }[] = [];
  for (const mainRow of data) {
    result.push({ row: mainRow, type: 'category' });
    if (mainRow.children) {
      for (const child of mainRow.children) {
        result.push({ row: child, type: 'detail' });
      }
    }
  }
  return result;
}

function buildTotalRow(data: ComparisonRow[]): ComparisonRow {
  if (data.length === 0) return { key: 'total', category: 'ИТОГО', tenders: [] };
  const numTenders = data[0].tenders.length;
  const totals = Array.from({ length: numTenders }, () => ({
    materials: 0, works: 0, total: 0, mat_per_unit: 0, work_per_unit: 0, total_per_unit: 0, volume: 0,
  }));
  for (const row of data) {
    for (let i = 0; i < numTenders; i++) {
      totals[i].materials += row.tenders[i]?.materials || 0;
      totals[i].works += row.tenders[i]?.works || 0;
      totals[i].total += row.tenders[i]?.total || 0;
    }
  }
  return { key: 'total', category: 'ИТОГО', is_main_category: true, tenders: totals };
}

function buildExportData(params: ExportParams): { data: any[][]; rowTypes: RowType[]; numTenders: number } {
  const { comparisonData, tenderLabels } = params;
  const numTenders = tenderLabels.length;
  const exportData: any[][] = [];
  const rowTypes: RowType[] = [];
  const hasDiff = numTenders === 2;

  // Row 1: group headers
  const headerRow: any[] = ['Категория затрат'];
  for (const label of tenderLabels) {
    headerRow.push(label, '', '', '', '', '');
  }
  if (hasDiff) headerRow.push('Разница', '', '', '', '', '');
  headerRow.push('Примечание');
  exportData.push(headerRow);
  rowTypes.push('header');

  // Row 2: sub-headers
  const subCols = ['Материалы', 'Работы', 'Итого', 'Мат/ед.', 'Раб/ед.', 'Итого/ед.'];
  const subHeaderRow: any[] = [''];
  for (let i = 0; i < numTenders; i++) subHeaderRow.push(...subCols);
  if (hasDiff) subHeaderRow.push(...subCols);
  subHeaderRow.push('');
  exportData.push(subHeaderRow);
  rowTypes.push('subheader');

  // Data rows
  const flat = flattenRows(comparisonData);
  for (const { row, type } of flat) {
    const dataRow: any[] = [type === 'detail' ? `    ${row.category}` : row.category.toUpperCase()];
    for (let i = 0; i < numTenders; i++) {
      const t = row.tenders[i] || { materials: 0, works: 0, total: 0, mat_per_unit: 0, work_per_unit: 0, total_per_unit: 0, volume: 0 };
      dataRow.push(t.materials, t.works, t.total, t.mat_per_unit || '', t.work_per_unit || '', t.total_per_unit || '');
    }
    if (hasDiff) {
      const t0 = row.tenders[0];
      const t1 = row.tenders[1];
      dataRow.push(
        t1.materials - t0.materials,
        t1.works - t0.works,
        t1.total - t0.total,
        (t1.mat_per_unit - t0.mat_per_unit) || '',
        (t1.work_per_unit - t0.work_per_unit) || '',
        (t1.total_per_unit - t0.total_per_unit) || '',
      );
    }
    dataRow.push(row.note || '');
    exportData.push(dataRow);
    rowTypes.push(type);
  }

  // Total row
  const totalRow = buildTotalRow(comparisonData);
  const totalDataRow: any[] = ['ИТОГО'];
  for (let i = 0; i < numTenders; i++) {
    const t = totalRow.tenders[i] || { materials: 0, works: 0, total: 0, mat_per_unit: 0, work_per_unit: 0, total_per_unit: 0, volume: 0 };
    totalDataRow.push(t.materials, t.works, t.total, '', '', '');
  }
  if (hasDiff) {
    const t0 = totalRow.tenders[0];
    const t1 = totalRow.tenders[1];
    totalDataRow.push(t1.materials - t0.materials, t1.works - t0.works, t1.total - t0.total, '', '', '');
  }
  totalDataRow.push('');
  exportData.push(totalDataRow);
  rowTypes.push('total');

  return { data: exportData, rowTypes, numTenders };
}

function configureWorksheet(ws: XLSX.WorkSheet, rowTypes: RowType[], numTenders: number): void {
  const hasDiff = numTenders === 2;
  const noteColIdx = 1 + numTenders * 6 + (hasDiff ? 6 : 0);
  const diffStartCol = hasDiff ? 1 + numTenders * 6 : -1;

  // Column widths
  const cols: any[] = [{ wch: 45 }];
  for (let i = 0; i < numTenders; i++) {
    cols.push({ wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 });
  }
  if (hasDiff) cols.push({ wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 });
  cols.push({ wch: 30 });
  ws['!cols'] = cols;

  // Merges for row 0
  const merges: any[] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
  ];
  for (let i = 0; i < numTenders; i++) {
    const start = 1 + i * 6;
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: start + 5 } });
  }
  if (hasDiff) merges.push({ s: { r: 0, c: diffStartCol }, e: { r: 0, c: diffStartCol + 5 } });
  merges.push({ s: { r: 0, c: noteColIdx }, e: { r: 1, c: noteColIdx } });
  ws['!merges'] = merges;

  // Per-unit column indices (for blue color)
  const perUnitCols = new Set<number>();
  for (let i = 0; i < numTenders; i++) {
    const start = 1 + i * 6;
    perUnitCols.add(start + 3);
    perUnitCols.add(start + 4);
    perUnitCols.add(start + 5);
  }
  if (hasDiff) {
    perUnitCols.add(diffStartCol + 3);
    perUnitCols.add(diffStartCol + 4);
    perUnitCols.add(diffStartCol + 5);
  }

  const beigeHeaderFill = { fgColor: { rgb: 'F5F5DC' } };
  const yellowCategoryFill = { fgColor: { rgb: 'FFFFE0' } };
  const totalFill = { fgColor: { rgb: 'D4EDDA' } };
  const whiteFill = { fgColor: { rgb: 'FFFFFF' } };
  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  };

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let R = range.s.r; R <= range.e.r; ++R) {
    const rowType = rowTypes[R];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[cellAddress]) ws[cellAddress] = { v: '', t: 's' };

      let fill = whiteFill;
      if (rowType === 'header' || rowType === 'subheader') fill = beigeHeaderFill;
      else if (rowType === 'category') fill = yellowCategoryFill;
      else if (rowType === 'total') fill = totalFill;

      let alignment: any = { vertical: 'center' };
      if (rowType === 'header' || rowType === 'subheader') {
        alignment.horizontal = 'center';
        alignment.wrapText = true;
      } else {
        alignment.horizontal = C === 0 ? 'left' : 'right';
      }

      let numFmt;
      if (C >= 1 && rowType !== 'header' && rowType !== 'subheader') numFmt = '#,##0';

      let font: any = {};
      if (rowType === 'header' || rowType === 'subheader' || rowType === 'category' || rowType === 'total') {
        font.bold = true;
      }
      if (perUnitCols.has(C) && rowType !== 'header' && rowType !== 'subheader') {
        font.color = { rgb: '0891B2' };
      }
      if (diffStartCol >= 0 && C >= diffStartCol && C < diffStartCol + 6 && rowType !== 'header' && rowType !== 'subheader') {
        const cellVal = ws[cellAddress].v;
        if (typeof cellVal === 'number') {
          font.color = { rgb: cellVal >= 0 ? '52C41A' : 'FF4D4F' };
        }
      }

      ws[cellAddress].s = {
        fill,
        border: thinBorder,
        alignment,
        ...(numFmt && { numFmt }),
        ...(Object.keys(font).length > 0 && { font }),
      };
    }
  }
}

export function exportComparisonToExcel(params: ExportParams): void {
  if (params.comparisonData.length === 0) {
    message.warning('Нет данных для экспорта');
    return;
  }

  try {
    const { data: exportData, rowTypes, numTenders } = buildExportData(params);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(exportData);
    configureWorksheet(ws, rowTypes, numTenders);
    XLSX.utils.book_append_sheet(wb, ws, 'Сравнение');

    const costLabel = params.costType === 'base' ? 'Прямые' : 'Коммерческие';
    const labelsStr = params.tenderLabels.length > 3
      ? `${params.tenderLabels.length}_объектов`
      : params.tenderLabels.join('_vs_').replace(/[/\\?*[\]:]/g, '_');
    const fileName = `Сравнение_${labelsStr}_${costLabel}_${dayjs().format('DD-MM-YYYY')}.xlsx`;

    XLSX.writeFile(wb, fileName);
    message.success('Файл успешно экспортирован');
  } catch (error: any) {
    console.error('Ошибка экспорта:', error);
    message.error('Ошибка экспорта: ' + error.message);
  }
}
