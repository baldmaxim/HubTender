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
  tender1Label: string;
  tender2Label: string;
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
  const total: ComparisonRow = {
    key: 'total',
    category: 'ИТОГО',
    is_main_category: true,
    tender1_materials: 0, tender1_works: 0, tender1_total: 0,
    tender2_materials: 0, tender2_works: 0, tender2_total: 0,
    diff_materials: 0, diff_works: 0, diff_total: 0,
    diff_materials_percent: 0, diff_works_percent: 0, diff_total_percent: 0,
    tender1_mat_per_unit: 0, tender1_work_per_unit: 0, tender1_total_per_unit: 0,
    tender2_mat_per_unit: 0, tender2_work_per_unit: 0, tender2_total_per_unit: 0,
    diff_mat_per_unit: 0, diff_work_per_unit: 0, diff_total_per_unit: 0,
    volume1: 0, volume2: 0,
  };

  for (const row of data) {
    total.tender1_materials += row.tender1_materials;
    total.tender1_works += row.tender1_works;
    total.tender1_total += row.tender1_total;
    total.tender2_materials += row.tender2_materials;
    total.tender2_works += row.tender2_works;
    total.tender2_total += row.tender2_total;
  }

  total.diff_materials = total.tender2_materials - total.tender1_materials;
  total.diff_works = total.tender2_works - total.tender1_works;
  total.diff_total = total.tender2_total - total.tender1_total;
  total.diff_materials_percent = total.tender1_materials > 0
    ? (total.diff_materials / total.tender1_materials) * 100 : 0;
  total.diff_works_percent = total.tender1_works > 0
    ? (total.diff_works / total.tender1_works) * 100 : 0;
  total.diff_total_percent = total.tender1_total > 0
    ? (total.diff_total / total.tender1_total) * 100 : 0;

  return total;
}

function buildExportData(
  params: ExportParams
): { data: any[][]; rowTypes: RowType[] } {
  const { comparisonData, tender1Label, tender2Label } = params;
  const exportData: any[][] = [];
  const rowTypes: RowType[] = [];

  // Row 1: group headers
  exportData.push([
    'Категория затрат',
    tender1Label, '', '', '', '', '',
    tender2Label, '', '', '', '', '',
    'Разница', '', '', '', '', '',
  ]);
  rowTypes.push('header');

  // Row 2: sub-headers
  exportData.push([
    '',
    'Материалы', 'Работы', 'Итого', 'Мат/ед.', 'Раб/ед.', 'Итого/ед.',
    'Материалы', 'Работы', 'Итого', 'Мат/ед.', 'Раб/ед.', 'Итого/ед.',
    'Материалы', 'Материалы %', 'Работы', 'Работы %', 'Итого', 'Итого %',
  ]);
  rowTypes.push('subheader');

  const flat = flattenRows(comparisonData);

  for (const { row, type } of flat) {
    exportData.push([
      type === 'detail' ? `    ${row.category}` : row.category.toUpperCase(),
      row.tender1_materials,
      row.tender1_works,
      row.tender1_total,
      row.tender1_mat_per_unit || '',
      row.tender1_work_per_unit || '',
      row.tender1_total_per_unit || '',
      row.tender2_materials,
      row.tender2_works,
      row.tender2_total,
      row.tender2_mat_per_unit || '',
      row.tender2_work_per_unit || '',
      row.tender2_total_per_unit || '',
      row.diff_materials,
      row.diff_materials_percent,
      row.diff_works,
      row.diff_works_percent,
      row.diff_total,
      row.diff_total_percent,
    ]);
    rowTypes.push(type);
  }

  // Total row
  const totalRow = buildTotalRow(comparisonData);
  exportData.push([
    'ИТОГО',
    totalRow.tender1_materials,
    totalRow.tender1_works,
    totalRow.tender1_total,
    '', '', '',
    totalRow.tender2_materials,
    totalRow.tender2_works,
    totalRow.tender2_total,
    '', '', '',
    totalRow.diff_materials,
    totalRow.diff_materials_percent,
    totalRow.diff_works,
    totalRow.diff_works_percent,
    totalRow.diff_total,
    totalRow.diff_total_percent,
  ]);
  rowTypes.push('total');

  return { data: exportData, rowTypes };
}

function configureWorksheet(ws: XLSX.WorkSheet, rowTypes: RowType[]): void {
  ws['!cols'] = [
    { wch: 45 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 12 },
  ];

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
    { s: { r: 0, c: 1 }, e: { r: 0, c: 6 } },
    { s: { r: 0, c: 7 }, e: { r: 0, c: 12 } },
    { s: { r: 0, c: 13 }, e: { r: 0, c: 18 } },
  ];

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
      if (!ws[cellAddress]) {
        ws[cellAddress] = { v: '', t: 's' };
      }

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
      if (C >= 1 && rowType !== 'header' && rowType !== 'subheader') {
        // Percent columns: 14, 16, 18
        if (C === 14 || C === 16 || C === 18) {
          numFmt = '0.0"%"';
        } else {
          numFmt = '#,##0';
        }
      }

      let font: any = {};
      if (rowType === 'header' || rowType === 'subheader' || rowType === 'category' || rowType === 'total') {
        font.bold = true;
      }
      // Per-unit columns in green
      if ((C >= 4 && C <= 6) || (C >= 10 && C <= 12)) {
        if (rowType !== 'header' && rowType !== 'subheader') {
          font.color = { rgb: '0891B2' };
        }
      }
      // Diff values coloring
      if (C >= 13 && rowType !== 'header' && rowType !== 'subheader') {
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
  const { comparisonData, costType, tender1Label, tender2Label } = params;

  if (comparisonData.length === 0) {
    message.warning('Нет данных для экспорта');
    return;
  }

  try {
    const { data: exportData, rowTypes } = buildExportData(params);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(exportData);
    configureWorksheet(ws, rowTypes);

    XLSX.utils.book_append_sheet(wb, ws, 'Сравнение');

    const costLabel = costType === 'base' ? 'Прямые' : 'Коммерческие';
    const fileName = `Сравнение_${tender1Label}_vs_${tender2Label}_${costLabel}_${dayjs().format('DD-MM-YYYY')}.xlsx`;

    XLSX.writeFile(wb, fileName);
    message.success('Файл успешно экспортирован');
  } catch (error: any) {
    console.error('Ошибка экспорта:', error);
    message.error('Ошибка экспорта: ' + error.message);
  }
}
