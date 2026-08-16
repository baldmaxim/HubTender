/**
 * Общие примитивы записи styled-листа в файл.
 *
 * xlsx-js-style@1.2.0 не умеет писать panes, поэтому книга всегда пишется в
 * память и OOXML пост-обрабатывается через fflate (injectFreezePane).
 */

import * as XLSX from 'xlsx-js-style';
import { injectFreezePane } from './strikeInject';

export function triggerDownload(data: Uint8Array, fileName: string): void {
  const blob = new Blob([data as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Пишет книгу с замороженной строкой заголовков и отдаёт файл на скачивание.
 */
export function writeSheetWithFrozenHeader(
  wb: XLSX.WorkBook,
  sheetName: string,
  fileName: string,
  rows = 1,
): void {
  const written = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const u8 = written instanceof Uint8Array ? written : new Uint8Array(written as ArrayBuffer);
  triggerDownload(injectFreezePane(u8, sheetName, rows), fileName);
}

/**
 * Проставить формулу + кэш-значение в ячейку (r/c — 0-based).
 * Формула пишется БЕЗ ведущего '='. Стиль ячейки сохраняется, поэтому вызывать
 * нужно ПОСЛЕ цикла применения стилей.
 */
export function setFormula(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  f: string,
  v: number | null,
): void {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell) return;
  cell.t = 'n';
  cell.f = f;
  if (v !== null && v !== undefined) cell.v = v;
  else delete cell.v;
}
