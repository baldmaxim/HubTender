// Чистая сборка листа Excel «Финансовые показатели» (без antd/writeFile) —
// по образцу «Финансовые показатели Образец.xlsx». Вынесено из exportToExcel,
// чтобы структуру можно было проверять в node.
import * as XLSX from 'xlsx-js-style';
import type { IndicatorRow } from '../types';

export const MONEY_FMT = '#,##0';
export const PCT_FMT = '0.##%';

// Цвета (заливки — из файла образца; шрифты title/объём/снижение — со скриншота).
const RED = 'FF0000'; // название тендера + объём строительства
const BLUE = '0070C0'; // строка снижения
const HEADER_FILL = 'C6D9F1'; // шапка
const CREAM = 'FFF9E6'; // страхование + дата

// База наценки = сумма Итого этих строк (по calc_key). Итог строки = база × коэф.
export const FORMULA_BASES: Record<string, string[]> = {
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
// База роста субподряда — не отображаемая строка → берём литералом (Итого / коэф).
export const LITERAL_BASE = new Set(['growth_sub_work', 'growth_sub_mat']);

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: number | undefined) => (typeof n === 'number' && isFinite(n) ? n : 0);

// Тёмная граница — чтобы линии были чётко видны (светлый D3D3D3 сливался с фоном).
const THIN = { style: 'thin', color: { rgb: '000000' } };
const MEDIUM = { style: 'medium', color: { rgb: '000000' } };
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

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

// Строки, чьё наименование выравнивается по правому краю: дочерние прямых затрат
// (Субподряд работы … Гарантийный период) и итоговые «Работы»/«Материалы».
const nameRightAligned = (row: IndicatorRow): boolean =>
  row.is_indented === true || row.calc_key === 'row_works' || row.calc_key === 'row_materials';

// Стиль ячейки данных: границы всегда; жирный у «Прямые»/ИТОГО; крем у страхования.
function rowStyle(row: IndicatorRow, col: number): Record<string, unknown> {
  const bold = row.is_total || row.calc_key === 'direct_costs';
  const cream = row.calc_key === 'insurance';
  const horizontal = col === 1 ? (nameRightAligned(row) ? 'right' : 'left') : 'center';
  const border = row.is_total ? { top: MEDIUM, bottom: MEDIUM, left: THIN, right: THIN } : BORDER;
  const s: Record<string, unknown> = {
    alignment: { horizontal, vertical: 'center', wrapText: true },
    border,
  };
  if (bold) s.font = { bold: true };
  if (cream) s.fill = { fgColor: { rgb: CREAM } };
  return s;
}

export interface SheetInput {
  data: IndicatorRow[];
  spTotal: number;
  customerTotal: number;
  tenderTitle: string;
  discountNote?: string | null;
  volumeTitle?: string;
  /** Дата верхней строки (по умолчанию — сегодня). Тесты передают фикс. дату. */
  today?: Date;
}

export function buildFinancialSheet(input: SheetInput): XLSX.WorkSheet {
  const { data, spTotal, customerTotal, tenderTitle, discountNote, volumeTitle } = input;
  const at = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
  const ws: Record<string, unknown> = {};
  const set = (r: number, c: number, cell: Record<string, unknown>) => {
    ws[at(r, c)] = cell;
  };

  const headers = [
    '№ п/п',
    'Наименование',
    'коэф-ты',
    `Площадь по СП\n${spTotal.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} м²\nстоимость на 1м²`,
    `Площадь Заказчика\n${customerTotal.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} м²\nстоимость на 1м²`,
    'Итого',
  ];

  // calc_key → Excel-строка (1-based). Данные начинаются с Excel-строки 4.
  const keyRow: Record<string, number> = {};
  data.forEach((row, i) => {
    if (row.calc_key) keyRow[row.calc_key] = i + 4;
  });

  // ── Строка 1: название тендера (объединено B1:F1), красный жирный ──
  set(0, 0, { t: 's', v: '', s: { border: BORDER } });
  set(0, 1, { t: 's', v: tenderTitle, s: { font: { bold: true, sz: 14, color: { rgb: RED } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BORDER } });
  for (let c = 2; c <= 5; c++) set(0, c, { t: 's', v: '', s: { border: BORDER } });

  // ── Строка 2: дата (A2, крем) + объём (B2:F2, зелёный жирный) ──
  const now = input.today ?? new Date();
  const dateSerial = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
  set(1, 0, { t: 'n', v: dateSerial, z: 'dd.mm.yyyy', s: { font: { bold: true }, fill: { fgColor: { rgb: CREAM } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BORDER } });
  set(1, 1, { t: 's', v: volumeTitle || '', s: { font: { bold: true, sz: 14, color: { rgb: RED } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BORDER } });
  for (let c = 2; c <= 5; c++) set(1, c, { t: 's', v: '', s: { border: BORDER } });

  // ── Строка 3: шапка ──
  headers.forEach((h, c) =>
    set(2, c, { t: 's', v: h, s: { font: { bold: true }, fill: { fgColor: { rgb: HEADER_FILL } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: BORDER } }),
  );

  // ── Строки данных (с Excel-строки 4) ──
  data.forEach((row, i) => {
    const rIdx = i + 3;
    const rExcel = i + 4;
    const isMarkup = num(row.coeff_pct) > 0 && (LITERAL_BASE.has(row.calc_key || '') || Boolean(FORMULA_BASES[row.calc_key || '']));

    set(rIdx, 0, { t: 'n', v: row.row_number, s: rowStyle(row, 0) });
    set(rIdx, 1, { t: 's', v: row.indicator_name, s: rowStyle(row, 1) });
    set(rIdx, 2, isMarkup
      ? { t: 'n', v: num(row.coeff_pct) / 100, z: PCT_FMT, s: rowStyle(row, 2) }
      : { t: 's', v: row.coefficient || '', s: rowStyle(row, 2) });
    set(rIdx, 3, spTotal > 0 ? { t: 'n', f: `F${rExcel}/${spTotal}`, z: MONEY_FMT, s: rowStyle(row, 3) } : { t: 'n', v: 0, z: MONEY_FMT, s: rowStyle(row, 3) });
    set(rIdx, 4, customerTotal > 0 ? { t: 'n', f: `F${rExcel}/${customerTotal}`, z: MONEY_FMT, s: rowStyle(row, 4) } : { t: 'n', v: 0, z: MONEY_FMT, s: rowStyle(row, 4) });

    let fCell: Record<string, unknown>;
    if (row.calc_key === 'direct_costs' && keyRow['subcontract_work'] && keyRow['warranty']) {
      fCell = { t: 'n', f: `SUBTOTAL(9,F${keyRow['subcontract_work']}:F${keyRow['warranty']})`, z: MONEY_FMT };
    } else if (row.calc_key === 'total' && keyRow['subcontract_work'] && keyRow['insurance']) {
      // ИТОГО = сумма строк Субподряд работы … Страхование (F5:F24). «Прямые»
      // (F4) — сама SUBTOTAL и вне диапазона → без двойного счёта; вложенных
      // SUBTOTAL внутри нет → это обычная сумма = grandTotal.
      fCell = { t: 'n', f: `SUBTOTAL(9,F${keyRow['subcontract_work']}:F${keyRow['insurance']})`, z: MONEY_FMT };
    } else if (row.calc_key === 'row_works' && keyRow['total'] && keyRow['row_materials']) {
      fCell = { t: 'n', f: `F${keyRow['total']}-F${keyRow['row_materials']}`, z: MONEY_FMT };
    } else if (isMarkup) {
      const f = markupFormula(row, rExcel, keyRow);
      fCell = f ? { t: 'n', f, z: MONEY_FMT } : { t: 'n', v: num(row.total_cost), z: MONEY_FMT };
    } else {
      fCell = { t: 'n', v: num(row.total_cost), z: MONEY_FMT };
    }
    fCell.s = rowStyle(row, 5);
    set(rIdx, 5, fCell);
  });

  // ── Строка снижения (после пустой строки), синим ──
  let lastRow = 2 + data.length;
  if (discountNote) {
    lastRow += 2;
    set(lastRow, 1, { t: 's', v: discountNote, s: { font: { color: { rgb: BLUE } } } });
  }

  ws['!ref'] = `A1:F${lastRow + 1}`;
  ws['!merges'] = [
    { s: { r: 0, c: 1 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 5 } },
  ];
  ws['!cols'] = [{ wch: 11.07 }, { wch: 57.64 }, { wch: 15.5 }, { wch: 20.5 }, { wch: 20.5 }, { wch: 25.5 }];
  ws['!rows'] = [{ hpt: 18.75 }, { hpt: 18.75 }, { hpt: 45 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 3 };

  return ws as XLSX.WorkSheet;
}
