/**
 * Группировка строк Excel (outline) для экспортов с деревом затрат.
 *
 * Лист должен открываться как страница: видны только строки верхнего уровня,
 * вложенные раскрываются кнопками «+» / уровнями 1-2-3 на полях листа.
 *
 * xlsx-js-style пишет из `ws['!rows']` только `outlineLevel` и `hidden`, но не
 * атрибут `collapsed` у строки-заголовка группы — без него Excel рисует у
 * свёрнутой группы «−» вместо «+». Дописываем его пост-обработкой OOXML через
 * fflate (тот же приём, что в strikeInject.ts / ganttChartExport.ts).
 */

import * as XLSX from 'xlsx-js-style';
import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import { resolveSheetPath, type ZipMap } from './strikeInject';
import { triggerDownload } from './sheetWriter';

/**
 * Проставляет уровни группировки по массиву уровней строк (0 — верхний уровень)
 * и сворачивает всё вложенное. Возвращает 1-based номера строк-заголовков
 * групп — их нужно передать в `writeSheetWithOutline` для атрибута `collapsed`.
 */
export function applyRowOutline(ws: XLSX.WorkSheet, levels: number[]): number[] {
  ws['!rows'] = levels.map((level) => ({ level, hidden: level > 0 }));
  // Итог группы стоит НАД детализацией (как в дереве на странице), значит
  // summaryBelow=0 — иначе Excel вешает кнопку группы на строку под ней.
  ws['!outline'] = { above: true };

  // Заголовок группы — строка, за которой идёт строка более глубокого уровня.
  const collapsedRows: number[] = [];
  for (let i = 0; i < levels.length - 1; i++) {
    if (levels[i + 1] > levels[i]) collapsedRows.push(i + 1);
  }
  return collapsedRows;
}

/** Дописать `collapsed="1"` строкам-заголовкам групп в записанном .xlsx. */
export function injectRowCollapsed(
  xlsxBytes: Uint8Array,
  sheetName: string,
  rows: number[],
): Uint8Array {
  if (rows.length === 0) return xlsxBytes;

  const files = unzipSync(xlsxBytes) as ZipMap;
  const sheetPath = resolveSheetPath(files, sheetName);
  const target = new Set(rows.map(String));

  const sheetXml = strFromU8(files[sheetPath]).replace(/<row\b[^>]*>/g, (tag) => {
    const rowNum = tag.match(/\br="(\d+)"/);
    if (!rowNum || !target.has(rowNum[1]) || /\bcollapsed=/.test(tag)) return tag;
    const selfClosing = tag.endsWith('/>');
    return `${tag.slice(0, selfClosing ? -2 : -1)} collapsed="1"${selfClosing ? '/>' : '>'}`;
  });

  files[sheetPath] = strToU8(sheetXml);
  return zipSync(files as unknown as Zippable);
}

/** Пишет книгу со свёрнутыми группами строк и отдаёт файл на скачивание. */
export function writeSheetWithOutline(
  wb: XLSX.WorkBook,
  sheetName: string,
  fileName: string,
  collapsedRows: number[],
): void {
  const written = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const u8 = written instanceof Uint8Array ? written : new Uint8Array(written as ArrayBuffer);
  triggerDownload(injectRowCollapsed(u8, sheetName, collapsedRows), fileName);
}
