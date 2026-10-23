import dayjs from 'dayjs';

const EMPTY = '—';
const NBSP = ' ';

/** «56 211,7»; пусто → «—». */
export const formatAreaValue = (area: number | null): string =>
  area === null ? EMPTY : area.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

/** «56 211,7 м²» (м² не отрывается от числа); пусто → «—». */
export const formatArea = (area: number | null): string =>
  area === null ? EMPTY : `${formatAreaValue(area)}${NBSP}м²`;

/** Суммарная площадь без дробной части: «1 570 240 м²». */
export const formatAreaTotal = (area: number): string =>
  `${Math.round(area).toLocaleString('ru-RU')}${NBSP}м²`;

/** YYYY-MM-DD → DD.MM.YYYY; пусто → «—». */
export const formatDate = (value: string | null): string => {
  if (!value) return EMPTY;
  const d = dayjs(value);
  return d.isValid() ? d.format('DD.MM.YYYY') : EMPTY;
};
