/**
 * Экспорт финансовых показателей в Excel.
 *
 * Значения — реальные числа (числовой формат с разделителем разрядов), а не
 * строки. Столбцы «за м²» — формулы =Итого/площадь. Строки-наценки — формулы
 * =(сумма ячеек базы) × ячейка_коэффициента (столбец C), поэтому при правке
 * коэффициента в листе всё пересчитывается. Границы — на всех ячейках.
 */

import { message } from 'antd';
import * as XLSX from 'xlsx-js-style';
import type { IndicatorRow } from '../hooks/useFinancialData';

const MONEY_FMT = '#,##0';
const PCT_FMT = '0.####%';

// База наценки = сумма Итого этих строк (по calc_key). Итог строки = база × коэф.
const FORMULA_BASES: Record<string, string[]> = {
  mechanization: ['work_su10'],
  mvp: ['work_su10'],
  warranty: ['work_su10'],
  coef16: ['work_su10', 'mechanization'],
  growth_work: ['work_su10', 'coef16', 'mvp', 'mechanization'],
  growth_mat: ['materials_su10'],
  unforeseeable: ['work_su10', 'coef16', 'materials_su10', 'mvp', 'mechanization'],
  ooz: ['work_su10', 'coef16', 'materials_su10', 'mvp', 'mechanization', 'growth_work', 'growth_mat', 'unforeseeable'],
  ooz_sub: ['subcontract_work', 'subcontract_mat', 'growth_sub_work', 'growth_sub_mat'],
  ofz: ['work_su10', 'coef16', 'materials_su10', 'mvp', 'mechanization', 'growth_work', 'growth_mat', 'unforeseeable', 'ooz'],
  profit: ['work_su10', 'coef16', 'materials_su10', 'mvp', 'mechanization', 'growth_work', 'growth_mat', 'unforeseeable', 'ooz', 'ofz'],
  profit_sub: ['subcontract_work', 'subcontract_mat', 'growth_sub_work', 'growth_sub_mat', 'ooz_sub'],
};
// База роста субподряда = subcontract*ForGrowth (с учётом исключений категорий),
// это НЕ отображаемая строка → базу берём литералом (Итого / коэффициент).
const LITERAL_BASE = new Set(['growth_sub_work', 'growth_sub_mat']);

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: number | undefined) => (typeof n === 'number' && isFinite(n) ? n : 0);

const BORDER = {
  top: { style: 'thin', color: { rgb: 'D3D3D3' } },
  bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
  left: { style: 'thin', color: { rgb: 'D3D3D3' } },
  right: { style: 'thin', color: { rgb: 'D3D3D3' } },
};

const headerStyle = {
  font: { bold: true },
  fill: { fgColor: { rgb: 'E0E0E0' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER,
};

// Итоговая формула наценочной строки (=(база) × C{row}) либо '' если базы нет.
function markupFormula(row: IndicatorRow, rExcel: number, keyRow: Record<string, number>): string {
  const coeffCell = `C${rExcel}`;
  const key = row.calc_key || '';
  if (LITERAL_BASE.has(key)) {
    const pct = num(row.coeff_pct);
    const base = pct > 0 ? num(row.total_cost) / (pct / 100) : 0;
    return `${round2(base)}*${coeffCell}`;
  }
  const keys = FORMULA_BASES[key];
  if (!keys) return '';
  const refs = keys.map((k) => (keyRow[k] ? `F${keyRow[k]}` : null));
  if (refs.some((x) => x === null)) return '';
  return `(${refs.join('+')})*${coeffCell}`;
}

// Стиль ячейки данных по типу строки (границы всегда).
function rowStyle(row: IndicatorRow, col: number): Record<string, unknown> {
  const center = { horizontal: 'center', vertical: 'center', wrapText: true };
  if (row.is_total && row.is_yellow) {
    return {
      font: { bold: true },
      fill: { fgColor: { rgb: 'FFF9E6' } },
      alignment: center,
      border: {
        top: { style: 'medium', color: { rgb: '000000' } },
        bottom: { style: 'medium', color: { rgb: '000000' } },
        left: BORDER.left,
        right: BORDER.right,
      },
    };
  }
  if (row.is_total) {
    return {
      font: { bold: true },
      fill: { fgColor: { rgb: 'F0F0F0' } },
      alignment: center,
      border: { top: { style: 'medium', color: { rgb: '000000' } }, bottom: { style: 'medium', color: { rgb: '000000' } }, left: BORDER.left, right: BORDER.right },
    };
  }
  if (row.is_yellow) {
    return { fill: { fgColor: { rgb: 'FFF9E6' } }, alignment: center, border: BORDER };
  }
  return {
    border: BORDER,
    alignment: { wrapText: true, vertical: 'center', horizontal: col === 1 ? 'left' : 'center' },
  };
}

export function exportFinancialIndicatorsToExcel(
  data: IndicatorRow[],
  spTotal: number,
  customerTotal: number,
  tenderTitle: string,
  tenderVersion: number,
  /** Примечание о применённом снижении; строки таблицы уже содержат сниженные суммы. */
  discountNote?: string | null,
) {
  if (data.length === 0) {
    message.warning('Нет данных для экспорта');
    return;
  }

  const headers = [
    '№ п/п',
    'Наименование',
    'коэф-ты',
    `Площадь по СП\n${spTotal.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} м²\nстоимость на 1м²`,
    `Площадь Заказчика\n${customerTotal.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} м²\nстоимость на 1м²`,
    'Итого\nитоговая стоимость',
  ];

  // calc_key → Excel-строка (1-based). Строка данных i → Excel-строка i+2.
  const keyRow: Record<string, number> = {};
  data.forEach((row, i) => {
    if (row.calc_key) keyRow[row.calc_key] = i + 2;
  });

  // Каркас: заголовок + по строке на показатель (значения перезапишем ниже).
  const aoa: (string | number)[][] = [headers];
  data.forEach((row) => aoa.push([row.row_number, row.indicator_name, '', '', '', num(row.total_cost)]));
  if (discountNote) {
    aoa.push([]);
    aoa.push(['', discountNote]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const at = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });

  // Заголовок.
  for (let c = 0; c < headers.length; c++) {
    const cell = ws[at(0, c)];
    if (cell) cell.s = headerStyle;
  }

  // Строки данных.
  data.forEach((row, i) => {
    const rIdx = i + 1; // 0-based строка ячейки
    const rExcel = i + 2; // 1-based для формул
    const isMarkup = num(row.coeff_pct) > 0 && (LITERAL_BASE.has(row.calc_key || '') || Boolean(FORMULA_BASES[row.calc_key || '']));

    // C — коэффициент. Наценочные строки: число-доля (для формулы), формат %.
    ws[at(rIdx, 2)] = isMarkup
      ? { t: 'n', v: num(row.coeff_pct) / 100, z: PCT_FMT }
      : { t: 's', v: row.coefficient || '' };

    // D/E — стоимость за 1 м² = Итого / площадь (формулой).
    ws[at(rIdx, 3)] = spTotal > 0 ? { t: 'n', f: `F${rExcel}/${spTotal}`, z: MONEY_FMT } : { t: 'n', v: 0, z: MONEY_FMT };
    ws[at(rIdx, 4)] = customerTotal > 0 ? { t: 'n', f: `F${rExcel}/${customerTotal}`, z: MONEY_FMT } : { t: 'n', v: 0, z: MONEY_FMT };

    // F — Итого. Наценки/«Работы» — формулой, остальное — числом.
    let fCell: Record<string, unknown>;
    if (row.calc_key === 'row_works' && keyRow['total'] && keyRow['row_materials']) {
      fCell = { t: 'n', f: `F${keyRow['total']}-F${keyRow['row_materials']}`, z: MONEY_FMT };
    } else if (isMarkup) {
      const f = markupFormula(row, rExcel, keyRow);
      fCell = f ? { t: 'n', f, z: MONEY_FMT } : { t: 'n', v: num(row.total_cost), z: MONEY_FMT };
    } else {
      fCell = { t: 'n', v: num(row.total_cost), z: MONEY_FMT };
    }
    ws[at(rIdx, 5)] = fCell;

    // Гарантируем существование A/B и проставляем стили всем 6 колонкам.
    if (!ws[at(rIdx, 0)]) ws[at(rIdx, 0)] = { t: 'n', v: row.row_number };
    if (!ws[at(rIdx, 1)]) ws[at(rIdx, 1)] = { t: 's', v: row.indicator_name };
    for (let c = 0; c < headers.length; c++) {
      const cell = ws[at(rIdx, c)];
      if (cell) cell.s = rowStyle(row, c);
    }
  });

  ws['!cols'] = [{ wch: 8 }, { wch: 45 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 25 }];
  ws['!rows'] = [{ hpt: 60 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Финансовые показатели');

  const fileName = `Финансовые показатели_${tenderTitle} (v${tenderVersion}).xlsx`;
  XLSX.writeFile(wb, fileName);

  message.success(`Данные экспортированы в файл ${fileName}`);
}
