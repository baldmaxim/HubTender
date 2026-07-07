// Извлечение зачёркивания (strikethrough) из .xlsx для полей позиций заказчика.
//
// Зачем не SheetJS: community-edition `xlsx` при cellStyles отдаёт в `.s` только
// заливку ячейки (см. safe_format → p.s = styles.Fills[fillid]); шрифт/strike ячейки
// недоступны. А полностью зачёркнутое ЧИСЛО (кол-во) несёт strike только в шрифте
// ячейки (числа не бывают rich-строками). Частичное зачёркивание текста хранится в
// rich-text runs (sharedStrings). Чтобы покрыть оба случая, читаем OOXML напрямую
// через fflate (паттерн уже используется в utils/excel/gantt/ganttChartExport.ts).
//
// Возврат безопасен для XSS by design: наружу отдаём структуру { t, s }, не HTML.

import { unzipSync, strFromU8 } from 'fflate';
import type { RichRuns, StrikeRun } from '../../lib/types/types/boq';

export interface StrikeColumns {
  item_no: number;
  work_name: number;
  client_note: number;
  volume: number;
}

// Стандартная раскладка BOQ-файла (подтверждена на реальных файлах):
// 0=item_no (N п/п), 2=work_name (Наименование), 4=volume (Кол-во), 5=client_note (Примечание).
export const BOQ_STRIKE_COLUMNS: StrikeColumns = {
  item_no: 0,
  work_name: 2,
  client_note: 5,
  volume: 4,
};

type TextField = 'item_no' | 'work_name' | 'client_note';

interface SharedString {
  runs: StrikeRun[] | null; // не null только для rich-строк (несколько <r>)
  text: string; // плоский текст (конкатенация)
}

const R_TAG = /<(?:\w+:)?r\b[^>]*>([\s\S]*?)<\/(?:\w+:)?r>/g;
const T_TAG = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/;
const RPR_TAG = /<(?:\w+:)?rPr\b[^>]*>([\s\S]*?)<\/(?:\w+:)?rPr>/;
const STRIKE_TAG = /<(?:\w+:)?strike\b([^>]*?)\/?>/;

function unescapeXml(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, e: string) => {
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        if (e[0] === '#') {
          const code = e[1] === 'x' || e[1] === 'X'
            ? parseInt(e.slice(2), 16)
            : parseInt(e.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return m;
      }
    }
  });
}

// <strike/> => зачёркнут; <strike val="0"/> => не зачёркнут.
function strikeOn(attrs: string): boolean {
  return !/val\s*=\s*"(?:0|false)"/i.test(attrs);
}

// Разобрать содержимое <si> или <is> в раны. null — если это не rich (нет <r>).
function parseRuns(inner: string): StrikeRun[] | null {
  if (!/<(?:\w+:)?r\b/.test(inner)) return null;
  const runs: StrikeRun[] = [];
  R_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = R_TAG.exec(inner)) !== null) {
    const body = m[1];
    const tm = body.match(T_TAG);
    if (!tm) continue;
    // Нормализуем переводы строк к \n (как в SheetJS .v), чтобы текст ранов
    // совпадал с плоским значением в work_name/client_note.
    const text = unescapeXml(tm[1]).replace(/\r\n?/g, '\n');
    if (text === '') continue; // пустые раны пропускаем
    let struck = false;
    const rpr = body.match(RPR_TAG);
    if (rpr) {
      const st = rpr[1].match(STRIKE_TAG);
      if (st) struck = strikeOn(st[1]);
    }
    runs.push({ t: text, s: struck });
  }
  return runs;
}

// Склеить соседние раны с одинаковым состоянием (компактнее хранение/рендер).
function mergeRuns(runs: StrikeRun[]): StrikeRun[] {
  const out: StrikeRun[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.s === r.s) last.t += r.t;
    else out.push({ t: r.t, s: r.s });
  }
  return out;
}

const SI_TAG = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;

function parseSharedStrings(xml: string | null): SharedString[] {
  const out: SharedString[] = [];
  if (!xml) return out;
  SI_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SI_TAG.exec(xml)) !== null) {
    const inner = m[1];
    const runs = parseRuns(inner);
    if (runs) {
      out.push({ runs, text: runs.map((r) => r.t).join('') });
    } else {
      const tm = inner.match(T_TAG);
      out.push({ runs: null, text: tm ? unescapeXml(tm[1]).replace(/\r\n?/g, '\n') : '' });
    }
  }
  return out;
}

// Индексы cellXfs, чей шрифт зачёркнут (whole-cell strike, в т.ч. числа).
function parseStruckXfs(stylesXml: string | null): Set<number> {
  const result = new Set<number>();
  if (!stylesXml) return result;

  // fontId -> зачёркнут ли шрифт
  const fontsBlock = stylesXml.match(/<(?:\w+:)?fonts\b[^>]*>([\s\S]*?)<\/(?:\w+:)?fonts>/);
  const struckFonts = new Set<number>();
  if (fontsBlock) {
    const fontRe = /<(?:\w+:)?font\b[^>]*>([\s\S]*?)<\/(?:\w+:)?font>|<(?:\w+:)?font\b[^>]*\/>/g;
    let fm: RegExpExecArray | null;
    let i = 0;
    while ((fm = fontRe.exec(fontsBlock[1])) !== null) {
      const inner = fm[1] || '';
      const st = inner.match(STRIKE_TAG);
      if (st && strikeOn(st[1])) struckFonts.add(i);
      i++;
    }
  }
  if (struckFonts.size === 0) return result;

  const xfsBlock = stylesXml.match(/<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/);
  if (!xfsBlock) return result;
  const xfRe = /<(?:\w+:)?xf\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?xf>)/g;
  let xm: RegExpExecArray | null;
  let idx = 0;
  while ((xm = xfRe.exec(xfsBlock[1])) !== null) {
    const tag = xm[0];
    // Если applyFont явно выключен — шрифт не применяется, strike игнорируем.
    const applyFont = tag.match(/applyFont\s*=\s*"([^"]*)"/);
    const fontIdM = tag.match(/fontId\s*=\s*"(\d+)"/);
    if (fontIdM && struckFonts.has(+fontIdM[1])
      && !(applyFont && /^(0|false)$/i.test(applyFont[1]))) {
      result.add(idx);
    }
    idx++;
  }
  return result;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"'));
  return m ? m[1] : null;
}

// "C155" -> { col: 2 (0-based), row: 154 (0-based, = excelRow-1) }
function splitRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  let col = 0;
  const letters = m[1];
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return { col: col - 1, row: parseInt(m[2], 10) - 1 };
}

// Путь первого листа книги (без хардкода sheet1.xml).
function resolveFirstSheetPath(read: (p: string) => string | null): string {
  const fallback = 'xl/worksheets/sheet1.xml';
  const wb = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) return fallback;
  const sheet = wb.match(/<(?:\w+:)?sheet\b[^>]*>/);
  if (!sheet) return fallback;
  const rid = attr(sheet[0], 'r:id') || attr(sheet[0], 'id');
  if (!rid) return fallback;
  const relRe = /<Relationship\b[^>]*>/g;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(rels)) !== null) {
    if (attr(rm[0], 'Id') === rid) {
      let target = attr(rm[0], 'Target') || '';
      if (!target) return fallback;
      if (target.startsWith('/')) return target.slice(1);
      target = target.replace(/^\.\//, '');
      return target.startsWith('xl/') ? target : 'xl/' + target;
    }
  }
  return fallback;
}

/**
 * Извлечь зачёркивание по строкам листа. Ключ Map — 0-based индекс строки листа
 * (совпадает с индексом строки в XLSX.utils.sheet_to_json(..., { header: 1 })).
 * В Map попадают только строки, где реально есть зачёркивание.
 * При любой ошибке разбора возвращается пустая Map (импорт не должен падать).
 */
export function extractStrikeByRow(
  fileBytes: ArrayBuffer,
  columns: StrikeColumns = BOQ_STRIKE_COLUMNS,
): Map<number, RichRuns> {
  const result = new Map<number, RichRuns>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(fileBytes));
  } catch {
    return result;
  }
  const read = (p: string): string | null => {
    const f = files[p];
    return f ? strFromU8(f) : null;
  };

  try {
    const struckXf = parseStruckXfs(read('xl/styles.xml'));
    const shared = parseSharedStrings(read('xl/sharedStrings.xml'));
    const sheetXml = read(resolveFirstSheetPath(read));
    if (!sheetXml) return result;

    const textCols = new Map<number, TextField>([
      [columns.item_no, 'item_no'],
      [columns.work_name, 'work_name'],
      [columns.client_note, 'client_note'],
    ]);
    const volumeCol = columns.volume;

    const cellRe = /<(?:\w+:)?c\b[^>]*\/>|<(?:\w+:)?c\b[^>]*>[\s\S]*?<\/(?:\w+:)?c>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(sheetXml)) !== null) {
      const tag = cm[0];
      const openM = tag.match(/^<(?:\w+:)?c\b([^>]*?)\/?>/);
      const attrs = openM ? openM[1] : '';
      const ref = attr(attrs, 'r');
      if (!ref) continue;
      const pos = splitRef(ref);
      if (!pos) continue;

      const field = textCols.get(pos.col);
      const isVolume = pos.col === volumeCol;
      if (field === undefined && !isVolume) continue;

      const sIdx = attr(attrs, 's');
      const cellStruck = sIdx != null && struckXf.has(+sIdx);

      if (isVolume) {
        if (cellStruck) {
          const rr = result.get(pos.row) ?? {};
          rr.volume_struck = true;
          result.set(pos.row, rr);
        }
        continue;
      }

      const t = attr(attrs, 't');
      const bodyM = tag.match(/>([\s\S]*)<\/(?:\w+:)?c>$/);
      const body = bodyM ? bodyM[1] : '';

      let runs: StrikeRun[] | null = null;
      let plainText = '';
      if (t === 's') {
        const vm = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
        const idx = vm ? parseInt(vm[1], 10) : NaN;
        const si = Number.isFinite(idx) ? shared[idx] : undefined;
        if (si) {
          runs = si.runs;
          plainText = si.text;
        }
      } else if (t === 'inlineStr') {
        const isM = body.match(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/);
        if (isM) {
          runs = parseRuns(isM[1]);
          const tm = isM[1].match(T_TAG);
          plainText = runs ? runs.map((r) => r.t).join('') : tm ? unescapeXml(tm[1]) : '';
        }
      } else if (t === 'str') {
        const vm = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
        plainText = vm ? unescapeXml(vm[1]) : '';
      }

      let finalRuns: StrikeRun[] | null = null;
      if (runs && runs.some((r) => r.s)) {
        finalRuns = mergeRuns(runs);
      } else if (cellStruck) {
        const text = runs ? runs.map((r) => r.t).join('') : plainText;
        if (text) finalRuns = [{ t: text, s: true }];
      }

      if (finalRuns && finalRuns.length) {
        const rr = result.get(pos.row) ?? {};
        rr[field as TextField] = finalRuns;
        result.set(pos.row, rr);
      }
    }
  } catch {
    return result;
  }

  return result;
}
