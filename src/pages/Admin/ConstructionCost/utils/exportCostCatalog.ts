import * as XLSX from 'xlsx-js-style';
import dayjs from 'dayjs';
import { writeSheetWithFrozenHeader } from '../../../../utils/excel/sheetWriter';
import type { TreeNode } from '../hooks/useConstructionCost';

const SHEET_NAME = 'Справочник затрат';
const HEADERS = ['Раздел', 'Заголовок', 'Конечная затрата', 'Единица измерения'];
const COLUMN_WIDTHS = [40, 60, 80, 18];
const BORDER_COLOR = { rgb: 'D3D3D3' };
const THIN_BORDER = {
  top: { style: 'thin', color: BORDER_COLOR },
  bottom: { style: 'thin', color: BORDER_COLOR },
  left: { style: 'thin', color: BORDER_COLOR },
  right: { style: 'thin', color: BORDER_COLOR },
};
const HEADER_STYLE = {
  font: { bold: true },
  fill: { fgColor: { rgb: 'E0E0E0' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: THIN_BORDER,
};
const DATA_STYLE = {
  alignment: { vertical: 'top', wrapText: true },
  border: THIN_BORDER,
};

/** Одна строка на каждую конечную затрату (локализацию) в порядке дерева на странице. */
export const buildCostCatalogRows = (tree: TreeNode[]): string[][] => {
  const rows: string[][] = [];
  tree.forEach((category) => {
    const details = category.children ?? [];
    if (details.length === 0) {
      rows.push([category.structure, '', '', category.unit]);
      return;
    }
    details.forEach((detail) => {
      const title = [category.structure, detail.structure].filter(Boolean).join(' / ');
      (detail.children ?? []).forEach((location) => {
        rows.push([
          category.structure,
          title,
          [category.structure, detail.structure, location.location].filter(Boolean).join(' / '),
          location.unit,
        ]);
      });
    });
  });
  return rows;
};

export const exportCostCatalogToExcel = (tree: TreeNode[]): void => {
  const rows = buildCostCatalogRows(tree);
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);

  const lastRow = rows.length;
  for (let r = 0; r <= lastRow; r++) {
    for (let c = 0; c < HEADERS.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };
      ws[cellRef].s = r === 0 ? HEADER_STYLE : DATA_STYLE;
    }
  }
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

  const fileName = `Справочник_затрат_${dayjs().format('DD-MM-YYYY')}.xlsx`;
  writeSheetWithFrozenHeader(wb, SHEET_NAME, fileName);
};
