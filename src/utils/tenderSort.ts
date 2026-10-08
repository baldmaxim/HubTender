// Порядок тендеров в списках и фильтрах выбора: самый новый номер сверху.
// Номера бывают «340», «330.1», «262.5», «001», «Т306» — сравниваем группы цифр
// как числа (262.10 выше 262.9, 330.1 выше 330), буквенный префикс не мешает.

const numberParts = (value: string): number[] => (value.match(/\d+/g) ?? []).map(Number);

/** Компаратор номеров тендеров по убыванию; пустой номер — в конец. */
export const compareTenderNumbersDesc = (
  left: string | null | undefined,
  right: string | null | undefined,
): number => {
  const a = numberParts(left ?? '');
  const b = numberParts(right ?? '');
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (b[i] ?? -1) - (a[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return (right ?? '').localeCompare(left ?? '', 'ru-RU');
};

interface ISortableTender {
  tender_number?: string | null;
  version?: number | null;
}

/** Копия списка: номер по убыванию, внутри номера — версия по убыванию. */
export const sortTendersByNumber = <T extends ISortableTender>(tenders: T[]): T[] =>
  [...tenders].sort(
    (a, b) =>
      compareTenderNumbersDesc(a.tender_number, b.tender_number) ||
      (b.version ?? 1) - (a.version ?? 1),
  );
