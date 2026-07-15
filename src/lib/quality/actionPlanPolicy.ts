// Этап 1.4: чистые helpers страницы «План действий» — приоритеты, компоненты,
// навигация из typed contract (без message parsing), next action, форматы.
// Без React/DOM; server rank НЕ пересчитывается клиентским score.
import type { PlanAction, PlanComponent, ActionPlanReport } from '../api/actionPlan';

/** Порядок band'ов: blocking выше high выше normal выше low. */
export const PRIORITY_ORDER: Record<string, number> = {
  blocking: 0, high: 1, normal: 2, low: 3,
};

/** Текст + иконка + цвет приоритета (не только цвет). */
export const PRIORITY_DISPLAY: Record<string, { label: string; icon: string; color: string }> = {
  blocking: { label: 'Блокирует', icon: '⛔', color: 'red' },
  high: { label: 'Высокий', icon: '🔺', color: 'volcano' },
  normal: { label: 'Средний', icon: '🔸', color: 'orange' },
  low: { label: 'Низкий', icon: 'ℹ️', color: 'blue' },
};

export function priorityDisplay(p: string): { label: string; icon: string; color: string } {
  return PRIORITY_DISPLAY[p] ?? { label: p || 'Неизвестно', icon: '❓', color: 'default' };
}

/** Источник действия — человекочитаемо. */
export const SOURCE_LABELS: Record<string, string> = {
  quality: 'Качество расчёта',
  price_benchmark: 'Ценовые отклонения',
  price_source: 'Источники цен',
};

export function sourceLabel(s: string): string {
  return SOURCE_LABELS[s] ?? s;
}

/** Статус компонента аналитики. */
export const COMPONENT_STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  available: { label: 'Доступно', color: 'green' },
  calculation_not_ready: { label: 'Расчёт не актуален', color: 'orange' },
  no_history: { label: 'Нет истории', color: 'default' },
  unavailable: { label: 'Недоступно', color: 'red' },
};

export function componentStatusDisplay(c: Pick<PlanComponent, 'status'>): { label: string; color: string } {
  return COMPONENT_STATUS_DISPLAY[c.status] ?? { label: c.status || 'Неизвестно', color: 'default' };
}

/** Следующее рекомендуемое действие — строго server rank 1 (никакого
 *  клиентского пересчёта приоритета). */
export function nextAction(actions: PlanAction[]): PlanAction | null {
  let best: PlanAction | null = null;
  for (const a of actions) {
    if (best === null || a.rank < best.rank) best = a;
  }
  return best && best.rank === 1 ? best : best;
}

export interface NavTarget {
  url: string;
  label: string;
}

/** Основная навигация действия — из typed contract (§13); неизвестный тип →
 *  безопасный fallback на страницу исходной аналитики, без падения. */
export function buildPrimaryNavigation(a: PlanAction, tenderId: string): NavTarget {
  const nav = a.navigation;
  switch (nav.type) {
    case 'boq_item':
    case 'duplicate_group': {
      if (nav.position_id) {
        const params = new URLSearchParams({ tenderId, positionId: nav.position_id });
        if (nav.item_id) params.set('itemId', nav.item_id);
        if (nav.field) params.set('field', nav.field);
        return { url: `/positions/${nav.position_id}/items?${params.toString()}`, label: 'К строке' };
      }
      return buildSourceNavigation(a, tenderId);
    }
    case 'tender_currency':
      return { url: `/admin/tenders?tenderId=${tenderId}&focus=rates`, label: 'К курсам тендера' };
    case 'financial_indicators':
      return { url: `/financial-indicators?tenderId=${tenderId}`, label: 'К финансовым показателям' };
    case 'redistribution':
      return { url: `/commerce/redistribution?tenderId=${tenderId}`, label: 'К перераспределению' };
    default:
      // Безопасный fallback: неизвестный navigation type → исходная аналитика.
      return buildSourceNavigation(a, tenderId);
  }
}

/** Secondary action: открыть исходный аналитический экран. */
export function buildSourceNavigation(a: PlanAction, tenderId: string): NavTarget {
  switch (a.source_navigation.analytics_page) {
    case 'price_benchmark':
      return { url: `/analytics/price-benchmark?tenderId=${tenderId}`, label: 'Ценовые отклонения' };
    case 'price_source':
      return { url: `/analytics/price-sources?tenderId=${tenderId}`, label: 'Источники цен' };
    default:
      return { url: `/analytics/quality?tenderId=${tenderId}`, label: 'Качество расчёта' };
  }
}

/** Impact amount: NaN/undefined/null → '—' (unavailable). */
export function formatImpact(a: Pick<PlanAction, 'impact_amount' | 'impact_amount_status'>): string {
  if (a.impact_amount_status !== 'available' || a.impact_amount == null || !isFinite(a.impact_amount)) {
    return '—';
  }
  return a.impact_amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatAmountValue(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Amount summary приходит с сервера; фронт его НЕ пересчитывает. */
export function summaryAmount(report: Pick<ActionPlanReport, 'summary'>): string {
  if (report.summary.amount_metrics_status !== 'available') return '—';
  return formatAmountValue(report.summary.amount_requiring_review);
}

/** Empty state (§12.G): нейтральная формулировка, не «ошибок нет». */
export const EMPTY_PLAN_TEXT = 'Обязательных действий не обнаружено.';
export const PLAN_AUTO_HINT =
  'Список формируется автоматически и обновляется после исправления данных.';
