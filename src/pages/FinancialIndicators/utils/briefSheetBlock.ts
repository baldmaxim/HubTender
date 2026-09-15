// Блок «Выжимка для руководства» под таблицей листа «Финансовые показатели».
// Чистая функция без xlsx-зависимости: возвращает ячейки и объединения, лист
// собирает buildFinancialSheet. Текст пишется только строковыми ячейками (t:'s'),
// поэтому «=…» в выжимке не станет формулой.
import { formatBriefFact, type BriefFact } from '../../../lib/quality/briefPolicy';

export interface BriefSheetInput {
  totalPerSp: number | null;
  facts: BriefFact[];
  summaryText: string;
}

export interface SheetCell {
  r: number;
  c: number;
  cell: Record<string, unknown>;
}

export interface BriefBlock {
  cells: SheetCell[];
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  lastRow: number;
}

const hasContent = (b: BriefSheetInput): boolean =>
  b.facts.length > 0 || b.totalPerSp !== null || b.summaryText.trim() !== '';

/** Блок начинается через одну пустую строку после afterRow (0-based). */
export function buildBriefBlock(brief: BriefSheetInput | null | undefined, afterRow: number): BriefBlock | null {
  if (!brief || !hasContent(brief)) return null;
  const cells: SheetCell[] = [];
  const merges: BriefBlock['merges'] = [];
  let r = afterRow + 2;
  const line = (text: string, bold = false) => {
    cells.push({ r, c: 1, cell: { t: 's', v: text, s: { font: { bold }, alignment: { vertical: 'top', wrapText: true } } } });
    merges.push({ s: { r, c: 1 }, e: { r, c: 5 } });
    r += 1;
  };

  line('Выжимка для руководства', true);
  if (brief.totalPerSp !== null) {
    line(`Итого по тендеру — ${Math.round(brief.totalPerSp).toLocaleString('ru-RU')} ₽/м² СП`);
  }
  brief.facts.forEach((f) => line(formatBriefFact(f)));

  const paragraphs = brief.summaryText.split(/\r?\n/).map((p) => p.trimEnd());
  if (paragraphs.some((p) => p !== '')) {
    r += 1;
    paragraphs.forEach((p) => line(p));
  }
  return { cells, merges, lastRow: r - 1 };
}
