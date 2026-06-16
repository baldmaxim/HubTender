import dayjs from 'dayjs';
import type {
  ChronologyItem,
  DashboardStatus,
  TenderPackageItem,
  TenderRegistryWithRelations,
} from '../../../lib/supabase';

export type TenderMonitorTab = 'all' | DashboardStatus;
export type TenderMonitorSortField = 'submission_date' | 'area' | 'total_cost';
export type TenderMonitorSortDirection = 'asc' | 'desc';

export const STANDARD_PACKAGE_ITEMS = ['ПД', 'ВОР', 'Договор', 'ТЗ на СМР', 'ТЗ на РД'] as const;

// Первый формат — для отображения, остальные — для разбора ввода без точек (ддммгггг).
export const DATE_INPUT_FORMATS = ['DD.MM.YYYY', 'DDMMYYYY', 'DDMMYY', 'D.M.YYYY'];

export const DASHBOARD_STATUS_OPTIONS: Array<{ value: DashboardStatus; label: string }> = [
  { value: 'calc', label: 'В расчете' },
  { value: 'sent', label: 'Направлено' },
  { value: 'waiting_pd', label: 'Ожидание ПД' },
  { value: 'archive', label: 'Архив' },
];

const statusOptionMap = new Map(DASHBOARD_STATUS_OPTIONS.map((item) => [item.value, item.label]));

export function getDashboardStatusLabel(status: DashboardStatus): string {
  return statusOptionMap.get(status) || status;
}

export function getDashboardStatusByStatusName(statusName?: string | null): DashboardStatus | null {
  const normalized = (statusName || '').trim().toLocaleLowerCase('ru-RU');

  if (!normalized) {
    return null;
  }

  if (normalized.includes('выиграл') || normalized.includes('проиграл')) {
    return 'archive';
  }

  if (normalized.includes('ожидаем тендерный пакет')) {
    return 'waiting_pd';
  }

  if (normalized === 'в работе') {
    return 'calc';
  }

  if (normalized === 'направлено') {
    return 'sent';
  }

  if (normalized.includes('ожида')) {
    return 'waiting_pd';
  }

  return null;
}

export function getDashboardStatus(tender: TenderRegistryWithRelations): DashboardStatus {
  const statusBasedValue = getDashboardStatusByStatusName(tender.status?.name);
  if (statusBasedValue) {
    return statusBasedValue;
  }

  if (tender.dashboard_status) {
    return tender.dashboard_status;
  }

  if (tender.is_archived) {
    return 'archive';
  }

  const statusName = (tender.status?.name || '').toLocaleLowerCase('ru-RU');
  if (statusName.includes('ожида')) {
    return 'waiting_pd';
  }

  return 'calc';
}

export function getTenderStatusDisplayLabel(tender: TenderRegistryWithRelations): string {
  const statusName = tender.status?.name?.trim();
  if (statusName) {
    return statusName;
  }

  return getDashboardStatusLabel(getDashboardStatus(tender));
}

export function getStatusBadgeStyle(status: DashboardStatus) {
  switch (status) {
    case 'sent':
      return {
        color: '#ef9f27',
        background: 'rgba(239,159,39,0.12)',
        border: '1px solid rgba(239,159,39,0.28)',
      };
    case 'waiting_pd':
      return {
        color: '#a78bfa',
        background: 'rgba(167,139,250,0.12)',
        border: '1px solid rgba(167,139,250,0.24)',
      };
    case 'archive':
      return {
        color: '#8b93a7',
        background: 'rgba(139,147,167,0.12)',
        border: '1px solid rgba(139,147,167,0.22)',
      };
    default:
      return {
        color: '#4a90e2',
        background: 'rgba(74,144,226,0.12)',
        border: '1px solid rgba(74,144,226,0.24)',
      };
  }
}

export function formatMoney(value?: number | null): string {
  if (value == null) {
    return '—';
  }

  const absValue = Math.abs(value);
  if (absValue >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1).replace('.', ',')} млрд ₽`;
  }

  if (absValue >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace('.', ',')} млн ₽`;
  }

  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

export function formatMoneyFull(value?: number | null): string {
  if (value == null) {
    return '—';
  }

  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

export function formatArea(value?: number | null): string {
  if (value == null) {
    return '—';
  }

  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} м²`;
}

export function formatDate(value?: string | null): string {
  if (!value) {
    return '—';
  }

  const date = dayjs(value);
  return date.isValid() ? date.format('DD.MM.YYYY') : '—';
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return '—';
  }

  const date = dayjs(value);
  return date.isValid() ? date.format('DD.MM.YYYY HH:mm') : '—';
}

export function formatRubPerSquare(totalCost?: number | null, area?: number | null): string {
  if (!totalCost || !area) {
    return '—';
  }

  return `${Math.round(totalCost / area).toLocaleString('ru-RU')} ₽`;
}

export function getChronologyItems(tender: TenderRegistryWithRelations): ChronologyItem[] {
  return (tender.chronology_items || [])
    .map((item) => ({
      date: item.date ?? null,
      text: item.text,
      type: item.type ?? 'default',
    }))
    .sort((left, right) => {
      if (!left.date) return 1;
      if (!right.date) return -1;
      return dayjs(left.date).valueOf() - dayjs(right.date).valueOf();
    });
}

export function getPackageItems(tender: TenderRegistryWithRelations): TenderPackageItem[] {
  return (tender.tender_package_items || [])
    .map((item) => ({
      date: item.date ?? null,
      text: item.text,
      link: item.link?.trim() || null,
    }))
    .sort((left, right) => {
      if (!left.date) return 1;
      if (!right.date) return -1;
      return dayjs(left.date).valueOf() - dayjs(right.date).valueOf();
    });
}

export function getPackageLinkHref(link?: string | null): string | null {
  const trimmed = link?.trim();

  if (!trimmed) {
    return null;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

const PACKAGE_BADGE_PRESETS = [
  { color: '#4a90e2', background: 'rgba(74,144,226,0.12)', border: '1px solid rgba(74,144,226,0.24)' },
  { color: '#10b981', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.24)' },
  { color: '#ef9f27', background: 'rgba(239,159,39,0.12)', border: '1px solid rgba(239,159,39,0.24)' },
  { color: '#8b5cf6', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.24)' },
  { color: '#ec4899', background: 'rgba(236,72,153,0.12)', border: '1px solid rgba(236,72,153,0.24)' },
  { color: '#14b8a6', background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.24)' },
] as const;

export function getTenderPackageBadgeStyle(text?: string | null) {
  const normalized = (text || '').trim().toLocaleLowerCase('ru-RU');

  if (!normalized) {
    return PACKAGE_BADGE_PRESETS[0];
  }

  if (normalized.includes('договор')) {
    return PACKAGE_BADGE_PRESETS[1];
  }

  if (normalized.includes('пд') || normalized.includes('проект')) {
    return PACKAGE_BADGE_PRESETS[2];
  }

  if (normalized.includes('вор') || normalized.includes('смет')) {
    return PACKAGE_BADGE_PRESETS[0];
  }

  if (normalized.includes('тз')) {
    return PACKAGE_BADGE_PRESETS[3];
  }

  const hash = Array.from(normalized).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return PACKAGE_BADGE_PRESETS[hash % PACKAGE_BADGE_PRESETS.length];
}

export function getLastCallFollowUpDate(tender: TenderRegistryWithRelations): string | null {
  const dates = getChronologyItems(tender)
    .filter((item) => item.type === 'call_follow_up' && item.date)
    .map((item) => item.date as string);

  if (dates.length === 0) {
    return null;
  }

  return dates.sort((left, right) => dayjs(right).valueOf() - dayjs(left).valueOf())[0];
}

export function getControlDate(tender: TenderRegistryWithRelations): string | null {
  const submissionDate = tender.submission_date;
  const followUpDate = getLastCallFollowUpDate(tender);

  if (!submissionDate) {
    return followUpDate;
  }

  if (!followUpDate) {
    return submissionDate;
  }

  return dayjs(followUpDate).isAfter(dayjs(submissionDate)) ? followUpDate : submissionDate;
}

export function getDaysSinceControl(tender: TenderRegistryWithRelations): number | null {
  const controlDate = getControlDate(tender);
  if (!controlDate) {
    return null;
  }

  return dayjs().startOf('day').diff(dayjs(controlDate).startOf('day'), 'day');
}

export function getDaysToSubmission(tender: TenderRegistryWithRelations): number | null {
  if (!tender.submission_date) {
    return null;
  }

  return dayjs(tender.submission_date).startOf('day').diff(dayjs().startOf('day'), 'day');
}

export function shouldShowCallAction(tender: TenderRegistryWithRelations): boolean {
  const status = getDashboardStatus(tender);
  const daysSinceControl = getDaysSinceControl(tender) ?? 0;

  if (status === 'sent') {
    return daysSinceControl > 7;
  }

  if (status === 'calc') {
    return getControlDate(tender) != null && daysSinceControl >= 7;
  }

  return false;
}

export function getPackageSummary(tender: TenderRegistryWithRelations) {
  const items = getPackageItems(tender);
  const normalizedTexts = items.map((item) => item.text.toLocaleLowerCase('ru-RU'));
  const standardCount = STANDARD_PACKAGE_ITEMS.filter((requiredItem) =>
    normalizedTexts.some((text) => text.includes(requiredItem.toLocaleLowerCase('ru-RU')))
  ).length;
  const extraCount = Math.max(0, items.length - standardCount);
  const percent = STANDARD_PACKAGE_ITEMS.length
    ? Math.round((standardCount / STANDARD_PACKAGE_ITEMS.length) * 100)
    : 0;

  return {
    totalCount: items.length,
    standardCount,
    extraCount,
    percent,
  };
}

export function sortTenders(
  tenders: TenderRegistryWithRelations[],
  field: TenderMonitorSortField,
  direction: TenderMonitorSortDirection
): TenderRegistryWithRelations[] {
  const factor = direction === 'asc' ? 1 : -1;

  return [...tenders].sort((left, right) => {
    const leftValue =
      field === 'submission_date'
        ? left.submission_date
          ? dayjs(left.submission_date).valueOf()
          : Number.MAX_SAFE_INTEGER
        : field === 'area'
          ? left.area || 0
          : left.total_cost || 0;
    const rightValue =
      field === 'submission_date'
        ? right.submission_date
          ? dayjs(right.submission_date).valueOf()
          : Number.MAX_SAFE_INTEGER
        : field === 'area'
          ? right.area || 0
          : right.total_cost || 0;

    if (leftValue < rightValue) {
      return -1 * factor;
    }

    if (leftValue > rightValue) {
      return 1 * factor;
    }

    return left.title.localeCompare(right.title, 'ru-RU', { sensitivity: 'base' });
  });
}

export function getTenderSearchText(tender: TenderRegistryWithRelations): string {
  return [
    tender.title,
    tender.client_name,
    tender.tender_number,
    tender.object_address,
    tender.object_coordinates,
    getDashboardStatusLabel(getDashboardStatus(tender)),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('ru-RU');
}

export function buildCallFollowUpItem(nowIso: string): ChronologyItem {
  return {
    date: nowIso,
    text: 'Позвонили заказчику',
    type: 'call_follow_up',
  };
}
