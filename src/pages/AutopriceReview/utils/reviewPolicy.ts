import { AUTOPRICE_APPROVER_ROLES } from '../constants';
import type { AutopriceBasis, AutopriceStatus, IReviewRow, VolumeSourceKind } from '../types';

/** «Не подтверждено»: статус не approved/excluded ИЛИ подтверждение снято правками. */
export const isNotApproved = (r: Pick<IReviewRow, 'status' | 'approval_stale'>): boolean =>
  (r.status !== 'approved' && r.status !== 'excluded') || r.approval_stale;

export const canApprove = (roleCode: string | undefined): boolean =>
  !!roleCode && AUTOPRICE_APPROVER_ROLES.includes(roleCode);

export interface IProgress {
  approved: number;
  total: number;
}

/** «Подтверждено N из M»: M без исключённых, N — действующие подтверждения. */
export const calcProgress = (rows: IReviewRow[]): IProgress => {
  let approved = 0;
  let total = 0;
  for (const r of rows) {
    if (r.status === 'excluded') continue;
    total += 1;
    if (r.status === 'approved' && !r.approval_stale) approved += 1;
  }
  return { approved, total };
};

export type StatusFilter = 'not_approved' | 'all' | 'stale' | AutopriceStatus;

export type VolumeFilter = 'all' | VolumeSourceKind;

export interface IReviewFilters {
  status: StatusFilter;
  basis: AutopriceBasis | null;
  volume: VolumeFilter;
  section: string | null;
  hasQuestions: boolean;
  hasFindings: boolean;
  noPrice: boolean;
  search: string;
}

export const DEFAULT_FILTERS: IReviewFilters = {
  status: 'not_approved',
  basis: null,
  volume: 'all',
  section: null,
  hasQuestions: false,
  hasFindings: false,
  noPrice: false,
  search: '',
};

const matchStatus = (r: IReviewRow, f: StatusFilter): boolean => {
  switch (f) {
    case 'all':
      return true;
    case 'not_approved':
      return isNotApproved(r);
    case 'stale':
      return r.approval_stale;
    case 'approved':
      return r.status === 'approved' && !r.approval_stale;
    default:
      return r.status === f;
  }
};

/** Нет поля volume_source (старый ответ) или null — объём из ВОР. */
const matchVolume = (r: IReviewRow, f: VolumeFilter): boolean =>
  f === 'all' || (r.volume_source?.kind ?? 'customer_boq') === f;

export const filterReviews = (rows: IReviewRow[], f: IReviewFilters): IReviewRow[] => {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (!matchStatus(r, f.status)) return false;
    if (f.basis && r.basis !== f.basis) return false;
    if (!matchVolume(r, f.volume)) return false;
    if (f.section && r.section !== f.section) return false;
    if (f.hasQuestions && r.questions.length === 0) return false;
    if (f.hasFindings && r.findings.length === 0) return false;
    if (f.noPrice && r.zero_price_count <= 0) return false;
    if (q) {
      const hay = `${r.position_number} ${r.item_no ?? ''} ${r.work_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
};

/** По номеру позиции (порядок строк в тендере). */
export const sortReviews = (rows: IReviewRow[]): IReviewRow[] =>
  [...rows].sort((a, b) => a.position_number - b.position_number);

export const uniqueSections = (rows: IReviewRow[]): string[] =>
  Array.from(new Set(rows.map((r) => r.section).filter((s): s is string => !!s))).sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );

/** Эффективный статус для показа: подтверждение снято → отдельная метка. */
export const isStaleApproval = (r: Pick<IReviewRow, 'status' | 'approval_stale'>): boolean =>
  r.status === 'approved' && r.approval_stale;
