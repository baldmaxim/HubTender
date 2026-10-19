import dayjs from 'dayjs';
import type {
  ChronologyItem,
  TenderPackageItem,
  TenderRegistryWithRelations,
  TenderStatus,
} from '../../../lib/types';
import {
  getChronologyItems,
  getDashboardStatus,
  getDashboardStatusByStatusName,
  getPackageItems,
} from './tenderMonitor';

// Черновик режима редактирования карточки тендера: все поля правятся разом
// и уходят одним PATCH /tender-registry/{id}/fields — только изменённые.

/** Псевдостатус «Направлено»: status_id = null + dashboard_status = 'sent'. */
export const SENT_STATUS_VALUE = '__sent__';

export interface ITenderInfoDraft {
  title: string;
  client_name: string;
  tender_number: string;
  construction_scope_id: string | null;
  /** id статуса справочника или SENT_STATUS_VALUE. */
  status: string | null;
  area: number | null;
  manual_total_cost: number | null;
  submission_date: string | null;
  commission_date: string | null;
  construction_start_date: string | null;
  invitation_date: string | null;
  object_address: string;
  object_coordinates: string;
  site_visit_photo_url: string;
}

export type ChronologyDraftRow = ChronologyItem & { key: number };
export type PackageDraftRow = TenderPackageItem & { key: number };

export interface ITenderDraft {
  info: ITenderInfoDraft;
  chronology: ChronologyDraftRow[];
  packageItems: PackageDraftRow[];
}

type TextField = 'title' | 'client_name' | 'tender_number' | 'object_address' | 'object_coordinates' | 'site_visit_photo_url';
type NumberField = 'area' | 'manual_total_cost';
type DateField = 'submission_date' | 'commission_date' | 'construction_start_date' | 'invitation_date';

const TEXT_FIELDS: TextField[] = [
  'title',
  'client_name',
  'tender_number',
  'object_address',
  'object_coordinates',
  'site_visit_photo_url',
];
const NUMBER_FIELDS: NumberField[] = ['area', 'manual_total_cost'];
const DATE_FIELDS: DateField[] = ['submission_date', 'commission_date', 'construction_start_date', 'invitation_date'];

let lastRowKey = 0;

/** Ключ React для строки хронологии/пакета, у самих строк id нет. */
export const nextDraftRowKey = (): number => ++lastRowKey;

export function getStatusDraftValue(tender: TenderRegistryWithRelations): string | null {
  return getDashboardStatus(tender) === 'sent' ? SENT_STATUS_VALUE : tender.status_id ?? null;
}

export function buildTenderDraft(tender: TenderRegistryWithRelations): ITenderDraft {
  return {
    info: {
      title: tender.title ?? '',
      client_name: tender.client_name ?? '',
      tender_number: tender.tender_number ?? '',
      construction_scope_id: tender.construction_scope_id ?? null,
      status: getStatusDraftValue(tender),
      area: tender.area ?? null,
      manual_total_cost: tender.manual_total_cost ?? null,
      submission_date: tender.submission_date ?? null,
      commission_date: tender.commission_date ?? null,
      construction_start_date: tender.construction_start_date ?? null,
      invitation_date: tender.invitation_date ?? null,
      object_address: tender.object_address ?? '',
      object_coordinates: tender.object_coordinates ?? '',
      site_visit_photo_url: tender.site_visit_photo_url ?? '',
    },
    chronology: getChronologyItems(tender).map((item) => ({ ...item, key: nextDraftRowKey() })),
    packageItems: getPackageItems(tender).map((item) => ({ ...item, key: nextDraftRowKey() })),
  };
}

// Нераспознанную дату (старые записи хронологии) оставляем как есть: toISOString на ней бросает.
const toIso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const date = dayjs(value);
  return date.isValid() ? date.toISOString() : value;
};

// Строка без текста не сохраняется — так в режиме редактирования удаляют строку.
export const serializeChronology = (rows: ChronologyItem[]) =>
  rows
    .map((item) => ({ date: toIso(item.date), text: item.text.trim(), type: item.type || 'default' }))
    .filter((item) => item.text);

export const serializePackage = (rows: TenderPackageItem[]) =>
  rows
    .map((item) => ({ date: toIso(item.date), text: item.text.trim(), link: item.link?.trim() || null }))
    .filter((item) => item.text);

function buildStatusPatch(value: string | null, tender: TenderRegistryWithRelations, statuses: TenderStatus[]) {
  if (value === SENT_STATUS_VALUE) {
    return { status_id: null, dashboard_status: 'sent', is_archived: false };
  }

  const mapped = getDashboardStatusByStatusName(statuses.find((status) => status.id === value)?.name);
  return {
    status_id: value,
    dashboard_status: mapped || tender.dashboard_status || 'calc',
    is_archived: mapped === 'archive',
  };
}

export const isInfoDraftValid = (info: ITenderInfoDraft): boolean =>
  Boolean(info.title.trim() && info.client_name.trim());

/** Патч из отличий черновика от снимка, взятого при входе в редактирование. */
export function buildRegistryPatch(
  original: ITenderDraft,
  draft: ITenderDraft,
  tender: TenderRegistryWithRelations,
  statuses: TenderStatus[]
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const before = original.info;
  const after = draft.info;

  TEXT_FIELDS.forEach((field) => {
    const next = after[field].trim() || null;
    if (next !== (before[field].trim() || null)) patch[field] = next;
  });

  NUMBER_FIELDS.forEach((field) => {
    if (after[field] !== before[field]) patch[field] = after[field];
  });

  DATE_FIELDS.forEach((field) => {
    const next = toIso(after[field]);
    if (next !== toIso(before[field])) patch[field] = next;
  });

  if (after.construction_scope_id !== before.construction_scope_id) {
    patch.construction_scope_id = after.construction_scope_id;
  }

  if (after.status !== before.status) {
    Object.assign(patch, buildStatusPatch(after.status, tender, statuses));
  }

  const chronology = serializeChronology(draft.chronology);
  if (JSON.stringify(chronology) !== JSON.stringify(serializeChronology(original.chronology))) {
    patch.chronology_items = chronology;
  }

  const packageItems = serializePackage(draft.packageItems);
  if (JSON.stringify(packageItems) !== JSON.stringify(serializePackage(original.packageItems))) {
    patch.tender_package_items = packageItems;
  }

  return patch;
}
