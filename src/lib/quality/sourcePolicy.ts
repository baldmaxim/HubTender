// Этап 1.3: чистые helpers страницы «Источники цен» — статусы, приоритет,
// URL safety, форматирование, deep links, валидация дат. Без React/DOM.
import type { SourceRow } from '../api/priceSource';

/** Статус: текст + иконка (не только цвет). Warning не называется ошибкой цены. */
export const SOURCE_STATUS_DISPLAY: Record<string, { label: string; icon: string; color: string }> = {
  FRESH: { label: 'Источник актуален', icon: '✅', color: 'green' },
  EXPIRING_SOON: { label: 'Срок действия скоро завершится', icon: '⏳', color: 'blue' },
  STALE: { label: 'Цена подтверждена давно — требует проверки', icon: '📅', color: 'orange' },
  EXPIRED: { label: 'Срок действия завершён — требует проверки', icon: '⌛', color: 'volcano' },
  SOURCE_MISSING: { label: 'Источник цены не указан', icon: '❔', color: 'gold' },
  PRICE_DATE_MISSING: { label: 'Дата цены неизвестна', icon: '🗓️', color: 'gold' },
  INVALID_SOURCE_DATES: { label: 'Даты источника требуют исправления', icon: '⚠️', color: 'red' },
  NOT_APPLICABLE: { label: 'Не участвует в покрытии', icon: '➖', color: 'default' },
};

export function sourceStatusDisplay(status: string): { label: string; icon: string; color: string } {
  return SOURCE_STATUS_DISPLAY[status] ?? { label: status || 'Неизвестно', icon: '❓', color: 'default' };
}

/** Ни один статус источника не блокирует согласование. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isSourceBlockingStatus(_status: string): false {
  return false;
}

/** Приоритет статусов (§13): invalid → expired → stale → missing source →
 *  missing date → expiring → fresh. */
export const SOURCE_STATUS_PRIORITY: Record<string, number> = {
  INVALID_SOURCE_DATES: 0, EXPIRED: 1, STALE: 2, SOURCE_MISSING: 3,
  PRICE_DATE_MISSING: 4, EXPIRING_SOON: 5, FRESH: 6, NOT_APPLICABLE: 7,
};

/** Безопасный URL: только http(s); javascript:/data:/file: и мусор → null. */
export function safeSourceUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null;
  } catch {
    return null;
  }
}

export function formatCoverage(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

export function formatAmount(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatAge(days: number | null | undefined): string {
  if (days == null || !isFinite(days)) return '—';
  return `${days} дн.`;
}

/** Amount-метрики доступны только при available (stale расчёт → «—» + note). */
export function amountMetricsAvailable(report: Pick<{ amount_metrics_status: string }, 'amount_metrics_status'>): boolean {
  return report.amount_metrics_status === 'available';
}

/** Deep link к строке — механизм этапа 1.1 (field = quote_link). */
export function buildSourceItemLink(row: Pick<SourceRow, 'boq_item_id' | 'client_position_id'>, tenderId: string): string {
  const params = new URLSearchParams({
    tenderId, positionId: row.client_position_id, itemId: row.boq_item_id, field: 'quote_link',
  });
  return `/positions/${row.client_position_id}/items?${params.toString()}`;
}

/** Inline-валидация дат формы (§9): формат, не в будущем, диапазон. */
export function validateSourceDates(priceDate: string | null, validUntil: string | null, today: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (priceDate && !re.test(priceDate)) return 'Дата цены: ожидается формат ГГГГ-ММ-ДД';
  if (validUntil && !re.test(validUntil)) return 'Действительно до: ожидается формат ГГГГ-ММ-ДД';
  if (priceDate && priceDate > today) return 'Дата цены не может быть в будущем';
  if (priceDate && validUntil && validUntil < priceDate) return 'Срок действия не может быть раньше даты цены';
  return null;
}
