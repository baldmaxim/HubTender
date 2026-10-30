import type { IAnalogHit, IAnalogScale, AnalogScaleMode, IAnalogTarget } from '../../../lib/api/analogs.types';

export { formatNumber, formatDateTime } from '../../../pages/AutopriceReview/utils/format';

const CURRENCY_SYMBOLS: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€', CNY: '¥' };

export const currencySymbol = (code: string | null): string => (code ? (CURRENCY_SYMBOLS[code] ?? code) : '');

export const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU');
};

const normUnit = (u: string | null): string => (u ?? '').trim().toLowerCase();

/** Единицы совпадают (trim + lower) и непустые. */
export const unitsMatch = (a: string | null, b: string | null): boolean => {
  const x = normUnit(a);
  return x !== '' && x === normUnit(b);
};

const positive = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;

/** Масштаб «пропорционально объёму» допустим: единицы совпадают и оба объёма > 0 (зеркало правила сервера). */
export const canVolumeRatio = (
  target: Pick<IAnalogTarget, 'unit_code' | 'volume'>,
  source: Pick<IAnalogHit, 'unit_code' | 'volume'>,
): boolean => unitsMatch(target.unit_code, source.unit_code) && positive(target.volume) && positive(source.volume);

/** Подсказка для показа: цель / источник (расчёт строк — только на сервере). */
export const volumeRatioHint = (target: number | null, source: number | null): number | null =>
  positive(target) && positive(source) ? target / source : null;

export const buildScale = (mode: AnalogScaleMode, factor: number | null): IAnalogScale =>
  mode === 'factor' && factor !== null ? { mode, factor } : { mode };

/** Сходство названия, %: сервер отдаёт долю 0..1 (если больше 1 — уже проценты). */
export const similarityPercent = (score: number): number =>
  Math.max(0, Math.min(100, Math.round(score <= 1 ? score * 100 : score)));

const BLOCKED_REASONS: Record<string, string> = {
  has_foreign_rows: 'В позиции уже есть строки, добавленные вручную или другим способом — аналог можно применить только к позиции без состава.',
  locked: 'Позиция подтверждена или исключена — сначала «Переоткрыть» в «Подтверждении авторасценки».',
};

export const blockedReasonText = (reason: string): string => BLOCKED_REASONS[reason] ?? reason;

/** Ключ идемпотентности: uuid; на небезопасном контексте — случайная строка той же формы. */
export const newIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Короткая сводка состава: «раб 3 · мат 5». */
export const summarizeRows = (rows: { boq_item_type: string }[]): string => {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.boq_item_type, (counts.get(r.boq_item_type) ?? 0) + 1);
  return [...counts].map(([t, n]) => `${t} ${n}`).join(' · ');
};

export const TARGET_STATE_TEXT: Record<IAnalogTarget['state'], string> = {
  empty: 'Состава нет',
  draft_only: 'Только черновик аналога (будет заменён)',
  has_foreign_rows: 'Есть строки, добавленные вручную',
  locked: 'Позиция подтверждена',
};
