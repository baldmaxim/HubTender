// Этап 1.6: чистые helpers страницы «Отчёт для проверки». Без React/DOM.
// Frontend НЕ пересчитывает executive summary и НЕ строит Excel — только
// отображает серверную модель и скачивает серверный файл.
import type { ReviewReport, ReviewSection, ReviewQuery } from '../api/reviewPack';

/** Сериализация параметров отчёта (чистая, без зависимостей от api-клиента). */
export function reviewQueryString(q: ReviewQuery): string {
  const params = new URLSearchParams();
  if (q.benchmark_period_months) params.set('benchmark_period_months', String(q.benchmark_period_months));
  if (q.source_max_age_days) params.set('source_max_age_days', String(q.source_max_age_days));
  if (q.baseline_tender_id) params.set('baseline_tender_id', q.baseline_tender_id);
  return params.toString();
}

/** Статусы компонентов отчёта. */
export const REVIEW_SECTION_DISPLAY: Record<string, { label: string; color: string }> = {
  available: { label: 'Готово', color: 'green' },
  no_data: { label: 'Нет данных', color: 'default' },
  baseline_not_available: { label: 'Нет предыдущей версии', color: 'default' },
  calculation_not_ready: { label: 'Расчёт не актуален', color: 'orange' },
  unavailable: { label: 'Недоступно', color: 'red' },
};

export function sectionDisplay(s: Pick<ReviewSection, 'status'>): { label: string; color: string } {
  return REVIEW_SECTION_DISPLAY[s.status] ?? { label: s.status || 'Неизвестно', color: 'default' };
}

/** Готовность к скачиванию: только актуальный финансовый расчёт (quality
 *  blockers НЕ блокируют — отчёт и нужен для их проверки; отсутствие baseline
 *  тоже НЕ блокирует). */
export function isDownloadReady(report: Pick<ReviewReport, 'status'>): boolean {
  return report.status === 'ready';
}

/** URL скачивания из preview (download_url приходит с сервера). */
export function buildDownloadUrl(tenderId: string, q: ReviewQuery): string {
  const qs = reviewQueryString(q);
  return `/api/v1/tenders/${tenderId}/review-report.xlsx${qs ? `?${qs}` : ''}`;
}

/** Короткое представление fingerprint (полный — в metadata/Excel). */
export function shortFingerprint(fp: string): string {
  if (!fp) return '—';
  return fp.length <= 16 ? fp : `${fp.slice(0, 8)}…${fp.slice(-8)}`;
}

export function approvalDisplay(md: { financial_approved: boolean; approved_by_label?: string; approved_at?: string }): string {
  if (!md.financial_approved) return 'Не согласован';
  let out = 'Согласован';
  if (md.approved_by_label) out += ` — ${md.approved_by_label}`;
  if (md.approved_at) out += ` (${md.approved_at.slice(0, 10)})`;
  return out;
}

export function formatReviewAmount(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const NOT_READY_TEXT =
  'Финансовый расчёт не актуален — отчёт формируется только для актуальной ревизии. Завершите пересчёт и обновите страницу.';

/** Cross-link цели. */
export function crossLinkActionPlan(tenderId: string): string {
  return `/analytics/action-plan?tenderId=${tenderId}`;
}
export function crossLinkChangeImpact(tenderId: string): string {
  return `/analytics/change-impact?tenderId=${tenderId}`;
}
