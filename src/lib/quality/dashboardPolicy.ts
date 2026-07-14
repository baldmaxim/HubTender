// Этап 1.1: чистые helpers панели «Качество расчёта» — фильтрация, порядок,
// готовность, deep-link цели. Без React/DOM: покрываются focused-скриптом
// scripts/checks/qualityFrontendPolicy.check.mjs.
import type { QualityIssue, QualityReport } from '../api/quality';

export const SEVERITY_ORDER: Record<string, number> = {
  blocker: 0,
  warning: 1,
  information: 2,
};

/** Текст+иконка severity — не только цвет (доступность). */
export const SEVERITY_LABELS: Record<string, { label: string; icon: string }> = {
  blocker: { label: 'Блокирует', icon: '⛔' },
  warning: { label: 'Предупреждение', icon: '⚠️' },
  information: { label: 'Инфо', icon: 'ℹ️' },
};

export function severityDisplay(severity: string): { label: string; icon: string } {
  return SEVERITY_LABELS[severity] ?? { label: severity || 'Неизвестно', icon: '❓' };
}

/** Категории — человекочитаемые ярлыки; неизвестный код отображается как есть. */
export const CATEGORY_LABELS: Record<string, string> = {
  CALCULATION_STATE: 'Статус расчёта',
  CURRENCY: 'Валюта',
  BOQ_INPUT: 'Данные BOQ',
  RELATIONS: 'Связи',
  DERIVED_CONSISTENCY: 'Согласованность сумм',
  REDISTRIBUTION: 'Перераспределение',
  APPROVAL: 'Согласование',
  COMPLETENESS: 'Полнота',
  DUPLICATES: 'Дубли',
};

export function categoryLabel(code: string): string {
  return CATEGORY_LABELS[code] ?? code;
}

export interface IssueFilters {
  severity?: string | null;
  category?: string | null;
  clientPositionId?: string | null;
  search?: string | null;
}

/** Фильтрация + детерминированная сортировка (blocker всегда выше warning). */
export function filterIssues(issues: QualityIssue[], f: IssueFilters): QualityIssue[] {
  const q = (f.search ?? '').trim().toLowerCase();
  const out = issues.filter((is) => {
    if (f.severity && is.severity !== f.severity) return false;
    if (f.category && is.category !== f.category) return false;
    if (f.clientPositionId && is.client_position_id !== f.clientPositionId) return false;
    if (q) {
      const hay = `${is.title} ${is.message} ${is.fix_hint} ${is.code}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return out.slice().sort((a, b) => {
    const ra = SEVERITY_ORDER[a.severity] ?? 3;
    const rb = SEVERITY_ORDER[b.severity] ?? 3;
    if (ra !== rb) return ra - rb;
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    if (a.entity_id !== b.entity_id) return a.entity_id < b.entity_id ? -1 : 1;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}

/** Green-ready ТОЛЬКО при 0 blockers и 0 warnings (blockers>0 никогда не green). */
export function resolveReadyState(report: Pick<QualityReport, 'summary'>): 'ready' | 'warnings' | 'blocked' {
  if (report.summary.blockers > 0) return 'blocked';
  if (report.summary.warnings > 0) return 'warnings';
  return 'ready';
}

/** Полнота: всегда конечное число с 1 знаком; NaN/Inf → '—'. */
export function formatCompleteness(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

export interface NavigationTarget {
  url: string;
  label: string;
}

/**
 * Deep-link цель issue: backend отдаёт entity/field — URL строит frontend.
 * BOQ-строка/позиция → страница позиции с positionId+itemId (+field);
 * tender-level FX/approval → соответствующий раздел.
 */
export function buildNavigationTarget(issue: QualityIssue, tenderId: string): NavigationTarget | null {
  const posId = issue.client_position_id;
  const itemId =
    issue.entity_type === 'boq_item'
      ? issue.entity_id
      : issue.affected_item_ids && issue.affected_item_ids.length > 0
        ? issue.affected_item_ids[0]
        : undefined;

  if (posId && (issue.entity_type === 'boq_item' || issue.entity_type === 'client_position' || itemId)) {
    const params = new URLSearchParams({ tenderId, positionId: posId });
    if (itemId) params.set('itemId', itemId);
    if (issue.field) params.set('field', issue.field);
    return {
      url: `/positions/${posId}/items?${params.toString()}`,
      label: 'К строке',
    };
  }

  switch (issue.category) {
    case 'CURRENCY':
      return { url: `/admin/tenders?tenderId=${tenderId}&focus=rates`, label: 'К курсам тендера' };
    case 'REDISTRIBUTION':
      return { url: `/commerce/redistribution?tenderId=${tenderId}`, label: 'К перераспределению' };
    case 'APPROVAL':
    case 'CALCULATION_STATE':
    case 'DERIVED_CONSISTENCY':
      return { url: `/financial-indicators?tenderId=${tenderId}`, label: 'К финансовым показателям' };
    default:
      return null;
  }
}
