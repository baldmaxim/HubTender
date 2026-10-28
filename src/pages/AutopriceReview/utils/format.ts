import { DECISION_LABELS } from '../constants';

export const formatNumber = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('ru-RU', { maximumFractionDigits: digits });

export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
};

export const positionLabel = (r: { position_number: number; item_no: string | null }): string =>
  r.item_no ? `${r.position_number} (${r.item_no})` : String(r.position_number);

const formatShortDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const formatFullDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .replace(',', '');
};

interface IDecisionSource {
  status: string;
  decided_action: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
}

/** Последнее решение: «Подтвердил Иванов · дата»; null, если решений не было. */
export const decisionText = (r: IDecisionSource, full = false): string | null => {
  let action = r.decided_action;
  let name = r.decided_by_name;
  let at = r.decided_at;
  // Подтверждение без записи решения (старые данные) — берём из полей подтверждения.
  if (!action && r.status === 'approved' && r.approved_by_name) {
    action = 'approve';
    name = r.approved_by_name;
    at = r.approved_at;
  }
  if (!action) return null;
  const verb = DECISION_LABELS[action] ?? action;
  const date = full ? formatFullDateTime(at) : formatShortDate(at);
  return `${verb} ${name ?? '—'}${date ? ` · ${date}` : ''}`;
};
