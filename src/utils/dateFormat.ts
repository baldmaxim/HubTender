import dayjs from 'dayjs';

const DEFAULT_FALLBACK = '—';

export function formatDate(value?: string | null, fallback = DEFAULT_FALLBACK): string {
  if (!value) return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.format('DD.MM.YYYY') : fallback;
}

export function formatDateTime(value?: string | null, fallback = DEFAULT_FALLBACK): string {
  if (!value) return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.format('DD.MM.YYYY HH:mm') : fallback;
}

export function formatDateTimeWithSeconds(value?: string | null, fallback = DEFAULT_FALLBACK): string {
  if (!value) return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.format('DD.MM.YYYY HH:mm:ss') : fallback;
}

export function formatDateShort(value?: string | null, fallback = DEFAULT_FALLBACK): string {
  if (!value) return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.format('DD.MM') : fallback;
}
