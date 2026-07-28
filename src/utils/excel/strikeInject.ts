// Инъекция зачёркивания (partial strikethrough) в уже записанный .xlsx.
//
// xlsx-js-style умеет писать только whole-cell strike (font.strike). Частичное
// зачёркивание внутри текста требует rich-text runs, которых он не пишет. Поэтому
// целевые ячейки после записи книги заменяем на inline rich string через
// пост-обработку OOXML на fflate (тот же приём, что в gantt/ganttChartExport.ts).
//
// Обратная операция к strikeExtract.ts (round-trip экспорта).

import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import type { StrikeRun } from '../../lib/types/types/boq';

type ZipMap = Record<string, Uint8Array>;

export interface StrikeCell {
  ref: string; // адрес ячейки, напр. "G5"
  runs: StrikeRun[]; // раны (частичное зачёркивание)
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Путь главного (первого нужного) листа по имени — как в ganttChartExport.ts.
function resolveSheetPath(files: ZipMap, sheetName: string): string {
  const wbXml = strFromU8(files['xl/workbook.xml']);
  const relsXml = strFromU8(files['xl/_rels/workbook.xml.rels']);

  let rid: string | null = null;
  const sheetRe = /<sheet\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = sheetRe.exec(wbXml)) !== null) {
    const tag = m[0];
    const nameMatch = tag.match(/name="([^"]*)"/);
    if (nameMatch && xmlUnescape(nameMatch[1]) === sheetName) {
      const ridMatch = tag.match(/r:id="([^"]*)"/);
      rid = ridMatch ? ridMatch[1] : null;
      break;
    }
  }
  if (!rid) throw new Error(`Лист "${sheetName}" не найден в workbook.xml`);

  const relMatch = relsXml.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`));
  if (!relMatch) throw new Error('Relationship для листа не найден');
  const targetMatch = relMatch[0].match(/Target="([^"]*)"/);
  if (!targetMatch) throw new Error('Target листа не найден');

  let target = targetMatch[1].replace(/^\//, '');
  if (!target.startsWith('xl/')) target = 'xl/' + target;
  return target;
}

// <is> из ранов: struck → <r><rPr><strike/></rPr><t…>…</t></r>, иначе без <rPr>.
function buildInlineString(runs: StrikeRun[]): string {
  const body = runs
    .map((r) => {
      const rpr = r.s ? '<rPr><strike/></rPr>' : '';
      return `<r>${rpr}<t xml:space="preserve">${xmlEscape(r.t)}</t></r>`;
    })
    .join('');
  return `<is>${body}</is>`;
}

/**
 * Заменить в листе ячейки из `cells` на inline rich string с зачёркиванием,
 * сохранив атрибут стиля `s=` (границы/заливка/выравнивание). Возвращает новые
 * байты .xlsx. За один проход по XML листа.
 */
export function injectStrikeRuns(
  xlsxBytes: Uint8Array,
  sheetName: string,
  cells: StrikeCell[],
): Uint8Array {
  if (cells.length === 0) return xlsxBytes;

  const files = unzipSync(xlsxBytes) as ZipMap;
  const sheetPath = resolveSheetPath(files, sheetName);
  const sheetXml = strFromU8(files[sheetPath]);

  const byRef = new Map<string, StrikeRun[]>();
  for (const c of cells) byRef.set(c.ref, c.runs);

  const cellRe = /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g;
  const newXml = sheetXml.replace(cellRe, (whole) => {
    const openTag = whole.match(/^<c\b[^>]*?\/?>/)?.[0] ?? whole;
    const refM = openTag.match(/\br="([A-Z]+\d+)"/);
    if (!refM) return whole;
    const runs = byRef.get(refM[1]);
    if (!runs) return whole;
    const sM = openTag.match(/\bs="([^"]*)"/);
    const sAttr = sM ? ` s="${sM[1]}"` : '';
    return `<c r="${refM[1]}"${sAttr} t="inlineStr">${buildInlineString(runs)}</c>`;
  });

  files[sheetPath] = strToU8(newXml);
  return zipSync(files as unknown as Zippable);
}

/**
 * Заморозить первые `rows` строк листа: xlsx-js-style 1.2.0 не поддерживает
 * panes на запись (`ws['!freeze']` игнорируется), поэтому впрыскиваем
 * <pane>/<selection> в <sheetView> листа пост-обработкой OOXML (fflate).
 * Возвращает новые байты .xlsx.
 */
export function injectFreezePane(
  xlsxBytes: Uint8Array,
  sheetName: string,
  rows = 1,
): Uint8Array {
  const files = unzipSync(xlsxBytes) as ZipMap;
  const sheetPath = resolveSheetPath(files, sheetName);
  let sheetXml = strFromU8(files[sheetPath]);

  const topLeft = `A${rows + 1}`;
  const paneXml =
    `<pane ySplit="${rows}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/>`;

  const selfClosing = /<sheetView\b[^>]*\/>/;
  const openTag = /<sheetView\b[^>]*?>/;

  if (selfClosing.test(sheetXml)) {
    // <sheetView …/> → <sheetView …>pane…</sheetView>
    sheetXml = sheetXml.replace(selfClosing, (tag) => `${tag.slice(0, -2)}>${paneXml}</sheetView>`);
  } else if (openTag.test(sheetXml)) {
    // <sheetView …>…</sheetView> → pane первым дочерним элементом
    sheetXml = sheetXml.replace(openTag, (tag) => `${tag}${paneXml}`);
  } else {
    // <sheetViews> нет — вставить целиком перед <sheetData
    const views = `<sheetViews><sheetView workbookViewId="0">${paneXml}</sheetView></sheetViews>`;
    sheetXml = sheetXml.replace(/<sheetData\b/, `${views}<sheetData`);
  }

  files[sheetPath] = strToU8(sheetXml);
  return zipSync(files as unknown as Zippable);
}
