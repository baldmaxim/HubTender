// Этап 1.5: чистые helpers страницы «Изменения расчёта» — статусы, дельты,
// bridge-геометрия, сверка, навигация. Без React/DOM. UI не выдаёт изменение
// конфигурации за доказанную денежную причину (§8/§13).
import type { ConfigChange, DiffItem, BridgeEntry, ChangeImpactReport } from '../api/changeImpact';

/** Статусы изменений: текст + иконка + цвет. */
export const CHANGE_STATUS_DISPLAY: Record<string, { label: string; icon: string; color: string }> = {
  ADDED: { label: 'Добавлена', icon: '➕', color: 'green' },
  REMOVED: { label: 'Удалена', icon: '➖', color: 'volcano' },
  MODIFIED: { label: 'Изменена', icon: '✏️', color: 'orange' },
  UNCHANGED: { label: 'Без изменений', icon: '⏸', color: 'default' },
  AMBIGUOUS_GROUP: { label: 'Группа строк', icon: '🧩', color: 'purple' },
};

export function changeStatusDisplay(s: string): { label: string; icon: string; color: string } {
  return CHANGE_STATUS_DISPLAY[s] ?? { label: s || 'Неизвестно', icon: '❓', color: 'default' };
}

export const AMBIGUOUS_GROUP_NOTE =
  'Несколько одинаково идентифицируемых строк сравниваются как группа.';

/** Дельта: знак + формат; NaN/Inf → '—'. */
export function formatDelta(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v > 0) return `+${s}`;
  if (v < 0) return `−${s}`;
  return s;
}

export function formatMoneyValue(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Безопасный процент изменения: base=0 → '—' (без Inf). */
export function formatDeltaPercent(baseline: number, delta: number): string {
  if (!isFinite(baseline) || !isFinite(delta) || baseline === 0) return '—';
  const pct = (delta / Math.abs(baseline)) * 100;
  if (!isFinite(pct)) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function directionDisplay(d: string): { label: string; color: string } {
  switch (d) {
    case 'increase': return { label: 'Рост', color: 'red' };
    case 'decrease': return { label: 'Снижение', color: 'green' };
    default: return { label: 'Без изменения', color: 'default' };
  }
}

/** Сверка (§7): mismatch не скрывается. */
export function reconciliationDisplay(summary: Pick<ChangeImpactReport['summary'], 'is_reconciled' | 'reconciliation_residual'>): { ok: boolean; text: string } {
  if (summary.is_reconciled) {
    return { ok: true, text: 'Изменение итога полностью согласовано по строкам и страхованию.' };
  }
  return {
    ok: false,
    text: `Изменение итоговой суммы не удалось полностью согласовать (расхождение ${formatDelta(summary.reconciliation_residual)} ₽).`,
  };
}

/** Bridge-геометрия для простого CSS-waterfall (без chart-библиотек):
 *  на входе только дельта-компоненты (без BASELINE/CURRENT_TOTAL). */
export interface BridgeBar {
  code: string;
  label: string;
  amount: number;
  offsetPercent: number;
  widthPercent: number;
  positive: boolean;
}

export function buildBridgeGeometry(entries: BridgeEntry[]): BridgeBar[] {
  const deltas = entries.filter((e) => e.code !== 'BASELINE_TOTAL' && e.code !== 'CURRENT_TOTAL');
  let running = 0;
  const points: { e: BridgeEntry; from: number; to: number }[] = [];
  let min = 0;
  let max = 0;
  for (const e of deltas) {
    const from = running;
    running += isFinite(e.amount) ? e.amount : 0;
    points.push({ e, from, to: running });
    min = Math.min(min, from, running);
    max = Math.max(max, from, running);
  }
  const span = max - min || 1;
  return points.map(({ e, from, to }) => ({
    code: e.code,
    label: e.label,
    amount: e.amount,
    offsetPercent: ((Math.min(from, to) - min) / span) * 100,
    widthPercent: Math.max(0.5, (Math.abs(to - from) / span) * 100),
    positive: to >= from,
  }));
}

/** Сумма bridge-дельт (для сверки на фронте — просто отображение). */
export function bridgeDeltaSum(entries: BridgeEntry[]): number {
  return entries
    .filter((e) => e.code !== 'BASELINE_TOTAL' && e.code !== 'CURRENT_TOTAL')
    .reduce((acc, e) => acc + (isFinite(e.amount) ? e.amount : 0), 0);
}

export interface NavTarget {
  url: string;
  label: string;
}

/** Deep-link к ТЕКУЩЕЙ строке; для REMOVED текущей строки нет —
 *  возвращается null (детали в drawer, без ложной ссылки). */
export function buildDiffItemNavigation(item: DiffItem, tenderId: string): NavTarget | null {
  if (item.status === 'REMOVED') return null;
  if (item.status === 'AMBIGUOUS_GROUP') return null; // §14: только drawer
  if (!item.client_position_id || !item.current_item_id) return null;
  const params = new URLSearchParams({
    tenderId, positionId: item.client_position_id, itemId: item.current_item_id,
  });
  return { url: `/positions/${item.client_position_id}/items?${params.toString()}`, label: 'К строке' };
}

/** Навигация изменения конфигурации (§14). */
export function buildConfigNavigation(change: Pick<ConfigChange, 'navigation'>, tenderId: string): NavTarget {
  switch (change.navigation) {
    case 'tender_currency':
      return { url: `/admin/tenders?tenderId=${tenderId}&focus=rates`, label: 'К курсам тендера' };
    case 'markup':
      return { url: `/admin/markup?tenderId=${tenderId}`, label: 'К наценкам' };
    case 'distribution':
      return { url: `/commerce/proposal?tenderId=${tenderId}`, label: 'К распределению' };
    case 'exclusions':
      return { url: `/commerce/redistribution?tenderId=${tenderId}`, label: 'К исключениям' };
    case 'insurance':
      return { url: `/admin/insurance?tenderId=${tenderId}`, label: 'К страхованию' };
    default:
      return { url: `/financial-indicators?tenderId=${tenderId}`, label: 'К финансовым показателям' };
  }
}

/** Формулировка config-изменения: факт одновременного изменения,
 *  НЕ причинная стоимость (§8). */
export function configChangeText(c: Pick<ConfigChange, 'label' | 'old_value' | 'new_value'>): string {
  return `Одновременно изменено: ${c.label} — ${c.old_value} → ${c.new_value}`;
}

/** Baseline-селектор: подпись кандидата. */
export function baselineOptionLabel(c: { version: number; approved_at: string; cached_grand_total: number }): string {
  const day = (c.approved_at || '').slice(0, 10) || '—';
  return `v${c.version} · согласована ${day} · итог ${formatMoneyValue(c.cached_grand_total)}`;
}

/** Empty-state тексты (§13.I). */
export const NO_BASELINE_TEXT =
  'Предыдущая согласованная и рассчитанная версия не найдена — сравнение недоступно.';
export const IDENTICAL_VERSIONS_TEXT = 'Версии идентичны: изменений не обнаружено.';
export const CALC_NOT_READY_TEXT =
  'Финансовый расчёт текущей версии не актуален — дождитесь пересчёта для сравнения версий.';
