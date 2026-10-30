import type { IVolumeSource } from '../types';

const NUMBER_FORMAT = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** Единицы с цифрой в записи показываем с верхним индексом: м3 → м³. */
export const formatVolumeUnit = (unit: string | null | undefined): string => {
  const u = (unit ?? '').trim();
  return u.replace(/^(м)\s*\.?\s*3$/i, '$1³').replace(/^(м)\s*\.?\s*2$/i, '$1²');
};

/** «2 446,447 м³»; без значения — пустая строка. */
export const formatVolumeValue = (value: number | null | undefined, unit?: string | null): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return [NUMBER_FORMAT.format(value), formatVolumeUnit(unit)].filter(Boolean).join(' ');
};

/** Непустые части описания источника: значение, label, ref, note. */
export const volumeSourceParts = (src: IVolumeSource): string[] =>
  [formatVolumeValue(src.value, src.unit), src.label, src.ref, src.note]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0);

/** Объём ВОР и объём ИИ различаются (с относительным допуском 1e-9). */
export const volumesDiffer = (a: number, b: number): boolean =>
  Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
