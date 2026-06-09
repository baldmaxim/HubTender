// Оркестрация экспорта блока «График» с нативными графиками Excel:
// SheetJS write → fflate unzip → инъекция chart/drawing-частей → zip → скачивание.

import * as XLSX from 'xlsx-js-style';
import type { WorkBook } from 'xlsx';
import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import type { ChartBlock } from './ganttChartData';
import {
  buildChartXml,
  buildContentTypeOverrides,
  buildDrawingRels,
  buildDrawingXml,
  buildSheetRelsNew,
  drawingRelEntry,
  xmlUnescape,
} from './ganttChartXml';

export interface GanttExportOptions {
  blocks: ChartBlock[];
  chartAoa: (string | number | null)[][];
  mainSheetName: string;
  fileName: string;
  /** Кол-во строк сетки на главном листе (заголовок + объекты + ИТОГО). */
  gridRows: number;
}

type ZipMap = Record<string, Uint8Array>;

/** Путь главного листа резолвится из workbook.xml + рельсов, без хардкода sheet1.xml. */
function resolveMainSheetPath(files: ZipMap, sheetName: string): string {
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
  if (!rid) throw new Error('Лист "' + sheetName + '" не найден в workbook.xml');

  const relMatch = relsXml.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`));
  if (!relMatch) throw new Error('Relationship для листа не найден');
  const targetMatch = relMatch[0].match(/Target="([^"]*)"/);
  if (!targetMatch) throw new Error('Target листа не найден');

  let target = targetMatch[1].replace(/^\//, '');
  if (!target.startsWith('xl/')) target = 'xl/' + target;
  return target;
}

/** Создаёт или дополняет рельсы листа relationship'ом на drawing; возвращает выбранный rId. */
function upsertSheetDrawingRel(files: ZipMap, relsPath: string): string {
  if (!files[relsPath]) {
    const relId = 'rId1';
    files[relsPath] = strToU8(buildSheetRelsNew(relId));
    return relId;
  }
  const xml = strFromU8(files[relsPath]);
  const ids = [...xml.matchAll(/Id="rId(\d+)"/g)].map((mm) => parseInt(mm[1], 10));
  const next = (ids.length ? Math.max(...ids) : 0) + 1;
  const relId = `rId${next}`;
  files[relsPath] = strToU8(xml.replace('</Relationships>', drawingRelEntry(relId) + '</Relationships>'));
  return relId;
}

function triggerDownload(data: Uint8Array, fileName: string): void {
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
 * Дописывает скрытый лист ChartData, инжектит нативные графики и скачивает файл.
 * Если графиков нет — обычное сохранение через SheetJS.
 */
export function exportGanttCompletionWithCharts(wb: WorkBook, opts: GanttExportOptions): void {
  const { blocks, chartAoa, mainSheetName, fileName, gridRows } = opts;

  if (blocks.length === 0) {
    XLSX.writeFile(wb, fileName);
    return;
  }

  // 1) Скрытый лист с данными для графиков.
  const chartWs = XLSX.utils.aoa_to_sheet(chartAoa);
  XLSX.utils.book_append_sheet(wb, chartWs, 'ChartData');
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Sheets = wb.Workbook.Sheets || [];
  const chartIdx = wb.SheetNames.indexOf('ChartData');
  wb.Workbook.Sheets[chartIdx] = { ...(wb.Workbook.Sheets[chartIdx] || {}), Hidden: 1 };

  // 2) Сериализация + распаковка zip.
  const written = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const u8 = written instanceof Uint8Array ? written : new Uint8Array(written as ArrayBuffer);
  const files = unzipSync(u8) as ZipMap;

  // 3) Путь главного листа и его рельсов.
  const mainPath = resolveMainSheetPath(files, mainSheetName);
  const mainBase = mainPath.split('/').pop() as string;
  const mainRelsPath = `xl/worksheets/_rels/${mainBase}.rels`;

  const count = blocks.length;

  // 4) Новые части: charts + drawing + рельсы drawing.
  blocks.forEach((blk, i) => {
    files[`xl/charts/chart${i + 1}.xml`] = strToU8(buildChartXml(blk, i));
  });
  files['xl/drawings/drawing1.xml'] = strToU8(buildDrawingXml(count, gridRows));
  files['xl/drawings/_rels/drawing1.xml.rels'] = strToU8(buildDrawingRels(count));

  // 5) Content types — Override на каждый chart + drawing.
  const ct = strFromU8(files['[Content_Types].xml']);
  files['[Content_Types].xml'] = strToU8(
    ct.replace('</Types>', buildContentTypeOverrides(count) + '</Types>'),
  );

  // 6) Рельсы листа + ссылка <drawing> в главном листе.
  const drawingRelId = upsertSheetDrawingRel(files, mainRelsPath);
  const mainXml = strFromU8(files[mainPath]);
  files[mainPath] = strToU8(
    mainXml.replace('</worksheet>', `<drawing r:id="${drawingRelId}"/></worksheet>`),
  );

  // 7) Сборка zip + скачивание.
  const zipped = zipSync(files as unknown as Zippable);
  triggerDownload(zipped, fileName);
}
