import { DERIVED_REASON_LABELS, LOADER_REASON_LABELS } from '../constants';
import type { IUnpricedRow, UnpricedDerivedReason, UnpricedLoaderReason } from '../types';

/** Значение фильтра по причине: `loader:<код>` или `derived:<код>` (коды no_volume совпадают). */
export type UnpricedReasonFilter = `loader:${UnpricedLoaderReason}` | `derived:${UnpricedDerivedReason}`;

export interface IUnpricedFilters {
  reason: UnpricedReasonFilter | null;
  /** Показывать заголовки и позиции без объёма (derived no_volume без причины загрузчика). */
  showHeaders: boolean;
}

export const DEFAULT_UNPRICED_FILTERS: IUnpricedFilters = { reason: null, showHeaders: false };

export const UNPRICED_REASON_OPTIONS: { value: UnpricedReasonFilter; label: string }[] = [
  ...(Object.keys(LOADER_REASON_LABELS) as UnpricedLoaderReason[]).map((c) => ({
    value: `loader:${c}` as const,
    label: `Загрузчик: ${LOADER_REASON_LABELS[c]}`,
  })),
  ...(Object.keys(DERIVED_REASON_LABELS) as UnpricedDerivedReason[]).map((c) => ({
    value: `derived:${c}` as const,
    label: DERIVED_REASON_LABELS[c],
  })),
];

const matchesReason = (r: IUnpricedRow, reason: UnpricedReasonFilter): boolean =>
  reason.startsWith('loader:')
    ? r.loader_reason_code === reason.slice('loader:'.length)
    : r.derived_reason === reason.slice('derived:'.length);

export const filterUnpriced = (rows: IUnpricedRow[], f: IUnpricedFilters): IUnpricedRow[] =>
  rows.filter((r) => {
    if (f.reason && !matchesReason(r, f.reason)) return false;
    // Явный выбор «Заголовок / без объёма» не должен давать пустой список.
    const explicitHeaders = f.reason === 'derived:no_volume';
    if (!f.showHeaders && !explicitHeaders && r.derived_reason === 'no_volume' && !r.loader_reason_code) return false;
    return true;
  });
