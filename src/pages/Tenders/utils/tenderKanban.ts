import type { DashboardStatus, TenderRegistryWithRelations, TenderStatus } from '../../../lib/types';
import { getDashboardStatus } from './tenderMonitor';
import type { TenderMonitorPalette } from './tenderMonitorTheme';

export type KanbanColumnKey = 'waiting_pd' | 'calc' | 'sent' | 'lost' | 'won';

export interface KanbanColumnDef {
  key: KanbanColumnKey;
  title: string;
  /** Значение tender_registry.dashboard_status, которое ставит перенос в колонку. */
  dashboard: DashboardStatus;
}

// Порядок колонок — воронка тендера.
export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  { key: 'waiting_pd', title: 'Ожидание ПД', dashboard: 'waiting_pd' },
  { key: 'calc', title: 'В работе', dashboard: 'calc' },
  { key: 'sent', title: 'Направлено', dashboard: 'sent' },
  { key: 'lost', title: 'Проиграли', dashboard: 'archive' },
  { key: 'won', title: 'Выиграли', dashboard: 'archive' },
];

const columnByKey = new Map(KANBAN_COLUMNS.map((column) => [column.key, column]));

export const getKanbanColumnDef = (key: KanbanColumnKey): KanbanColumnDef => columnByKey.get(key)!;

export const isKanbanColumnKey = (value: unknown): value is KanbanColumnKey =>
  typeof value === 'string' && columnByKey.has(value as KanbanColumnKey);

const normalize = (value?: string | null) => (value || '').trim().toLocaleLowerCase('ru-RU');

/** Колонка тендера: «Выиграли»/«Проиграли» — по имени статуса, остальное — как вкладки перечня. */
export function getKanbanColumn(tender: TenderRegistryWithRelations): KanbanColumnKey {
  const statusName = normalize(tender.status?.name);
  if (statusName.includes('выиграл')) return 'won';
  if (statusName.includes('проиграл')) return 'lost';

  const dashboard = getDashboardStatus(tender);
  // Архив без «Выиграли» в имени статуса считаем проигранным.
  return dashboard === 'archive' ? 'lost' : dashboard;
}

// Статус справочника tender_statuses, который ставит перенос в колонку.
// «Направлено» — псевдостатус (status_id = null + dashboard_status = 'sent'), как в карточке тендера.
function findStatusForColumn(key: KanbanColumnKey, statuses: TenderStatus[]): TenderStatus | null {
  const byName = (match: (name: string) => boolean) => statuses.find((status) => match(normalize(status.name))) ?? null;

  switch (key) {
    case 'waiting_pd':
      return byName((name) => name.includes('ожидаем тендерный пакет')) ?? byName((name) => name.includes('ожида'));
    case 'calc':
      return byName((name) => name === 'в работе');
    case 'lost':
      return byName((name) => name.includes('проиграл'));
    case 'won':
      return byName((name) => name.includes('выиграл'));
    default:
      return null;
  }
}

export interface KanbanStatusPatch {
  status_id: string | null;
  dashboard_status: DashboardStatus;
  is_archived: boolean;
}

export interface KanbanTarget {
  patch: KanbanStatusPatch;
  status: TenderStatus | null;
}

/** Что записать при переносе в колонку; null — подходящего статуса в справочнике нет. */
export function resolveKanbanTarget(key: KanbanColumnKey, statuses: TenderStatus[]): KanbanTarget | null {
  const { dashboard } = getKanbanColumnDef(key);

  if (key === 'sent') {
    return { patch: { status_id: null, dashboard_status: dashboard, is_archived: false }, status: null };
  }

  const status = findStatusForColumn(key, statuses);
  if (!status) return null;

  return {
    patch: { status_id: status.id, dashboard_status: dashboard, is_archived: dashboard === 'archive' },
    status,
  };
}

/** Снимок полей статуса до переноса — для «Отменить». */
export function snapshotStatusPatch(tender: TenderRegistryWithRelations, column: KanbanColumnKey): KanbanTarget {
  return {
    patch: {
      status_id: tender.status_id ?? null,
      // dashboard_status=null бэкенд не пишет — подставляем значение колонки.
      dashboard_status: tender.dashboard_status ?? getKanbanColumnDef(column).dashboard,
      is_archived: !!tender.is_archived,
    },
    status: tender.status ?? null,
  };
}

export function getKanbanAccent(key: KanbanColumnKey, palette: TenderMonitorPalette): string {
  switch (key) {
    case 'waiting_pd':
      return palette.pending;
    case 'calc':
      return palette.info;
    case 'sent':
      return palette.sent;
    case 'won':
      return palette.successStrong;
    default:
      return palette.danger;
  }
}

export const getTenderCost = (tender: TenderRegistryWithRelations): number =>
  tender.total_cost || tender.manual_total_cost || 0;
