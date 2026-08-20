import dayjs from 'dayjs';

/** Дата-время для таблиц страницы доступа к API. Пустое значение — прочерк. */
export const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const d = dayjs(value);
  return d.isValid() ? d.format('DD.MM.YYYY HH:mm') : '—';
};
