// Промежуточные итоги по разделам для экспортов «Форма КП» и «Перераспределение».
// Раздел (не листовая позиция) получает SUBTOTAL(9, диапазон потомков);
// SUBTOTAL(9) игнорирует вложенные SUBTOTAL — двойного счёта нет, а общий
// итог листа тоже считается через SUBTOTAL(9) по всем строкам данных.

export interface SectionRowMeta {
  isLeaf: boolean;
  isAdditional: boolean;
  hierarchyLevel: number;
}

export interface SectionRange {
  rowIndex: number; // 0-based индекс строки-раздела в rows[]
  startIdx: number; // 0-based индекс первого потомка
  endIdx: number; // 0-based индекс последнего потомка
}

/**
 * Диапазоны потомков для строк-разделов. Потомки — до следующей не-ДОП строки
 * с уровнем ≤ уровня раздела (ДОП не граница, но входит в диапазон).
 * `hasOwnValue(i)` — у раздела есть собственные суммы (нетипично); такую
 * строку не трогаем, иначе её деньги пропали бы из итога.
 */
export function computeSectionRanges(
  rows: SectionRowMeta[],
  hasOwnValue: (rowIndex: number) => boolean = () => false,
): SectionRange[] {
  const out: SectionRange[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.isLeaf || row.isAdditional || hasOwnValue(i)) continue;
    const level = row.hierarchyLevel;
    let endIdx = i;
    for (let j = i + 1; j < rows.length; j++) {
      const rj = rows[j];
      if (!rj.isAdditional && rj.hierarchyLevel <= level) break;
      endIdx = j;
    }
    if (endIdx <= i) continue;
    out.push({ rowIndex: i, startIdx: i + 1, endIdx });
  }
  return out;
}

/** Сумма значений диапазона без строк-разделов (как посчитает SUBTOTAL(9)). */
export function sumExcludingSections(
  values: number[],
  sectionRows: Set<number>,
  startIdx: number,
  endIdx: number,
): number {
  let sum = 0;
  for (let k = startIdx; k <= endIdx; k++) {
    if (!sectionRows.has(k)) sum += values[k] ?? 0;
  }
  return sum;
}
