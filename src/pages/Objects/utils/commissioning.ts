import dayjs from 'dayjs';
import { formatDate } from './format';

export interface ICommissioning {
  /** Коротко: «31.10.2015», «2018–2019». */
  text: string;
  /** Полностью: «с 15.12.2018 по 20.01.2019». */
  title: string;
}

/**
 * Ввод в эксплуатацию: одна дата либо очереди (первый этап — последний).
 * Один год — «2019», разные годы — «2018–2019»; точные даты — в title.
 */
export const formatCommissioning = (
  start: string | null,
  end: string | null,
): ICommissioning | null => {
  if (!start && !end) return null;
  if (!start || !end || start === end) {
    const single = formatDate(end ?? start);
    return { text: single, title: `Дата ввода: ${single}` };
  }
  const startYear = dayjs(start).year();
  const endYear = dayjs(end).year();
  return {
    text: startYear === endYear ? String(endYear) : `${startYear}–${endYear}`,
    title: `Ввод: с ${formatDate(start)} по ${formatDate(end)}`,
  };
};
