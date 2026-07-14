// Этап 1.2: чистые helpers страницы «Ценовые отклонения» — статусы, шкала,
// проценты, deep links. Без React/DOM (focused-скрипт
// scripts/checks/priceBenchmarkFrontendPolicy.check.mjs).
import type { BenchmarkItem } from '../api/priceBenchmark';

/** Статус: текст + иконка (не только цвет). Отклонение — «требует проверки»,
 *  НИКОГДА не «ошибка»/«blocker». */
export const BENCHMARK_STATUS_DISPLAY: Record<string, { label: string; icon: string; color: string }> = {
  HIGH_OUTLIER: { label: 'Выше исторического диапазона — требует проверки', icon: '📈', color: 'orange' },
  LOW_OUTLIER: { label: 'Ниже исторического диапазона — требует проверки', icon: '📉', color: 'gold' },
  WITHIN_RANGE: { label: 'В историческом диапазоне', icon: '✅', color: 'green' },
  INSUFFICIENT_HISTORY: { label: 'Недостаточно истории', icon: '⏳', color: 'default' },
  NOT_ELIGIBLE: { label: 'Нет точной номенклатурной привязки', icon: '🚫', color: 'default' },
};

export function benchmarkStatusDisplay(status: string): { label: string; icon: string; color: string } {
  return BENCHMARK_STATUS_DISPLAY[status] ?? { label: status || 'Неизвестно', icon: '❓', color: 'default' };
}

/** Outlier — предупреждение, не blocker: никакой статус бенчмарка не блокирует. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isBlockingStatus(_status: string): false {
  return false;
}

/** Безопасный процент: NaN/Inf/null → '—'. */
export function formatPercent(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

export function formatMoney(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface ScaleGeometry {
  /** Позиции меток в процентах [0..100]. */
  min: number; p25: number; median: number; p75: number; max: number;
  /** Маркер текущей цены, clamped в [0..100]. */
  current: number;
  /** Текущая цена вне исторического диапазона (выше max / ниже min). */
  outOfRange: 'above' | 'below' | null;
  valid: boolean;
}

/**
 * Геометрия шкалы min—P25—median—P75—max + маркер current.
 * IQR=0 / вырожденный диапазон → все метки в центре, без NaN;
 * current за пределами — clamped к краю с пометкой outOfRange.
 */
export function buildScaleGeometry(it: Pick<BenchmarkItem,
  'minimum' | 'p25' | 'median' | 'p75' | 'maximum' | 'current_unit_cost'>): ScaleGeometry {
  const invalid: ScaleGeometry = {
    min: 0, p25: 0, median: 50, p75: 100, max: 100, current: 50, outOfRange: null, valid: false,
  };
  const { minimum, p25, median, p75, maximum } = it;
  if (minimum == null || p25 == null || median == null || p75 == null || maximum == null) return invalid;
  const lo = Math.min(minimum, it.current_unit_cost);
  const hi = Math.max(maximum, it.current_unit_cost);
  const span = hi - lo;
  const pos = (v: number) => (span <= 0 ? 50 : ((v - lo) / span) * 100);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  let outOfRange: ScaleGeometry['outOfRange'] = null;
  if (it.current_unit_cost > maximum) outOfRange = 'above';
  else if (it.current_unit_cost < minimum) outOfRange = 'below';
  const g: ScaleGeometry = {
    min: clamp(pos(minimum)),
    p25: clamp(pos(p25)),
    median: clamp(pos(median)),
    p75: clamp(pos(p75)),
    max: clamp(pos(maximum)),
    current: clamp(pos(it.current_unit_cost)),
    outOfRange,
    valid: true,
  };
  return [g.min, g.p25, g.median, g.p75, g.max, g.current].every(isFinite) ? g : invalid;
}

/** Deep link к текущей строке — механизм этапа 1.1 (positionId+itemId). */
export function buildBenchmarkItemLink(it: Pick<BenchmarkItem, 'boq_item_id' | 'client_position_id'>, tenderId: string): string {
  const params = new URLSearchParams({
    tenderId, positionId: it.client_position_id, itemId: it.boq_item_id,
  });
  return `/positions/${it.client_position_id}/items?${params.toString()}`;
}

/** 409 FINANCIAL_CALCULATION_NOT_READY → понятное пользовательское состояние. */
export function calculationNotReadyMessage(): string {
  return 'Для анализа цен сначала дождитесь актуального расчёта тендера.';
}

export function coverageDisplay(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}
