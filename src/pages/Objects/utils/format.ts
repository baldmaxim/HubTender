import dayjs from 'dayjs';

const EMPTY = '—';

/** «56 211,7»; пусто → «—». */
export const formatAreaValue = (area: number | null): string =>
  area === null ? EMPTY : area.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

/** «56 211,7 м²»; пусто → «—». */
export const formatArea = (area: number | null): string =>
  area === null ? EMPTY : `${formatAreaValue(area)} м²`;

/** YYYY-MM-DD → DD.MM.YYYY; пусто → «—». */
export const formatDate = (value: string | null): string => {
  if (!value) return EMPTY;
  const d = dayjs(value);
  return d.isValid() ? d.format('DD.MM.YYYY') : EMPTY;
};

/** «1 объект», «2 объекта», «5 объектов». */
export const formatObjectsCount = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word = 'объектов';
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) word = 'объект';
    else if (mod10 >= 2 && mod10 <= 4) word = 'объекта';
  }
  return `${n.toLocaleString('ru-RU')} ${word}`;
};
