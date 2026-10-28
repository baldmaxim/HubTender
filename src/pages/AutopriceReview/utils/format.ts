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
