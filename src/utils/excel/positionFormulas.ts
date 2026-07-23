// Билдеры Excel-формул для экспорта «Позиции заказчика». Чистые функции без
// зависимости от xlsx — возвращают строки формул БЕЗ ведущего '=' (движок .f).
// Модель расчёта — см. src/utils/boq/calculateBoqAmount.ts (source of truth).
import type { ExportRow } from './types';

// Буквы колонок Excel (0-based индекс → буква):
//  J=9 коэфф.перевода, K=10 коэфф.расхода, L=11 Кол-во ГП,
//  O=14 Стоимость доставки, P=15 Цена за единицу (сырая валюта), Q=16 Итого.
const J = 'J';
const K = 'K';
const L = 'L';
const O = 'O';
const P = 'P';

const WORK_TYPES = ['раб', 'суб-раб', 'раб-комп.'];
const isWork = (t?: string | null): boolean => !!t && WORK_TYPES.includes(t);

// Множитель курса: '' если FX≈1 (₽), иначе '*<fx>' (курс числом-литералом).
const fxMul = (fx?: number): string => (fx && Math.abs(fx - 1) > 1e-9 ? `*${fx}` : '');

export interface ItemFormulas {
  gp?: string; // Кол-во ГП (только линк-материал)
  delivery?: string; // Стоимость доставки (только «не в цене»)
  total?: string; // Итоговая сумма
}

/**
 * Формулы для строки BOQ-item. `ownRow`/`parentWorkRow` — 1-based Excel-строки.
 * Итого: работа `L*P*FX`; линк-материал `L*(P*FX+O)`; не-линк `L*K*(P*FX+O)`.
 * Доставка «не в цене»: `P*FX*0.03`. ГП линк-материала: `Lработа*J*K`.
 * Множители J/K/K включаем только когда коэфф. задан (≠0) — иначе пустая ячейка = 0 в Excel.
 */
export function buildItemFormulas(
  row: ExportRow,
  ownRow: number,
  parentWorkRow?: number,
): ItemFormulas {
  const r = ownRow;
  const fx = fxMul(row.fxRate);
  const linked = !!row.parentWorkItemId;
  const hasConv = !!row.conversionCoeff && row.conversionCoeff !== 0;
  const hasCons = !!row.consumptionCoeff && row.consumptionCoeff !== 0;
  const out: ItemFormulas = {};

  // Итоговая сумма
  if (isWork(row.boqItemType)) {
    out.total = `${L}${r}*${P}${r}${fx}`;
  } else {
    const priceDelivery = `(${P}${r}${fx}+${O}${r})`;
    out.total = linked
      ? `${L}${r}*${priceDelivery}`
      : `${L}${r}${hasCons ? `*${K}${r}` : ''}*${priceDelivery}`;
  }

  // Стоимость доставки «не в цене» = цена·курс·0.03
  if (row.deliveryPriceType === 'не в цене') {
    out.delivery = `${P}${r}${fx}*0.03`;
  }

  // Кол-во ГП линк-материала = работа.ГП × перевод × расход
  if (linked && parentWorkRow) {
    out.gp = `${L}${parentWorkRow}${hasConv ? `*${J}${r}` : ''}${hasCons ? `*${K}${r}` : ''}`;
  }

  return out;
}

export interface SubtotalRange {
  rowIndex: number; // 0-based индекс строки-позиции в rows[]
  formula: string; // 'SUBTOTAL(9,Q<start>:Q<end>)'
  cachedSum: number; // сумма totalAmount строк-items в диапазоне (кэш-значение)
}

/**
 * Диапазоны SUBTOTAL для строк-позиций. Листовая/ДОП с items → её собственные
 * строки-items; раздел (isLeaf=false) → все потомки до следующей позиции с
 * hierarchy_level ≤ уровня раздела (ДОП не считается границей, но входит в диапазон).
 * SUBTOTAL(9) игнорирует вложенные SUBTOTAL → без двойного счёта. Позиции без
 * строк-items в диапазоне пропускаются (остаются как есть).
 */
export function computeSubtotalRanges(rows: ExportRow[]): SubtotalRange[] {
  const out: SubtotalRange[] = [];
  const excel = (i: number): number => i + 2; // header = Excel row 1

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.isPosition) continue;

    const startIdx = i + 1;
    let endIdx: number;

    if (!row.isLeaf) {
      // Раздел: потомки до следующей не-ДОП позиции с уровнем ≤ текущего.
      const level = row.hierarchyLevel ?? 0;
      let j = i + 1;
      endIdx = i;
      while (j < rows.length) {
        const rj = rows[j];
        if (rj.isPosition && !rj.isAdditional && (rj.hierarchyLevel ?? 0) <= level) break;
        endIdx = j;
        j++;
      }
    } else {
      // Листовая/ДОП: собственные строки-items сразу после позиции.
      let j = i + 1;
      while (j < rows.length && !rows[j].isPosition) j++;
      endIdx = j - 1;
    }

    if (endIdx < startIdx) continue;

    let sum = 0;
    let hasItem = false;
    for (let k = startIdx; k <= endIdx; k++) {
      if (!rows[k].isPosition) {
        hasItem = true;
        sum += rows[k].totalAmount ?? 0;
      }
    }
    if (!hasItem) continue;

    out.push({
      rowIndex: i,
      formula: `SUBTOTAL(9,Q${excel(startIdx)}:Q${excel(endIdx)})`,
      cachedSum: sum,
    });
  }

  return out;
}
