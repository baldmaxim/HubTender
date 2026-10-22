/**
 * Общие функции форматирования для review.md, itog.md и сводок. Чистый модуль.
 */

/** Подписи меток оценки. */
export const LABEL_RU = {
  likely_error: 'ошибка',
  likely_ok: 'норма',
  unsure: 'не уверен',
};

/** Подписи полей, на которые ссылается модель (evidence). */
export const FIELD_LABELS = {
  type: 'тип',
  name: 'наим.',
  unit: 'ед.',
  quantity: 'кол-во',
  conversion_coefficient: 'К перев.',
  consumption_coefficient: 'К расх.',
  unit_rate: 'цена',
  currency: 'валюта',
  total: 'сумма',
  bound_to_work: 'привязка',
  cost_category: 'категория',
  description: 'описание',
  item_no: '№',
  customer_name: 'наим. заказчика',
  customer_volume: 'кол-во заказчика',
  gp_volume: 'Кол-во ГП',
  gp_note: 'прим. ГП',
  client_note: 'прим. заказчика',
  detail: 'детали',
};

/** Обрезка по символам Unicode с «…». */
export const clipText = (s, max) => {
  const chars = Array.from(String(s ?? ''));
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
};

/**
 * Текст в одну строку, безопасную для review.md: без переводов строк и служебных скобок ‹ ›.
 * @param {unknown} s
 */
export const oneLine = (s) =>
  String(s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/‹/g, '«')
    .replace(/›/g, '»')
    .replace(/ {2,}/g, ' ')
    .trim();

/** Число с десятичной запятой, не больше одного знака после неё: 1.20 → «1,2», 3 → «3». */
const ruNumber = (value) => {
  const rounded = Math.round(value * 10) / 10;
  return String(rounded).replace('.', ',');
};

/**
 * Сумма разницы для строки находки: «Δ 1,2 млн ₽», «Δ 48 тыс. ₽», «Δ 950 ₽».
 * Пустая строка, если суммы нет или она нулевая.
 * @param {number | null | undefined} value
 */
export const formatMoney = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) === 0) return '';
  const num = Number(value);
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  let body;
  if (abs >= 1_000_000) body = `${ruNumber(abs / 1_000_000)} млн ₽`;
  else if (abs >= 10_000) body = `${Math.round(abs / 1000)} тыс. ₽`;
  else if (abs >= 1000) body = `${ruNumber(abs / 1000)} тыс. ₽`;
  else body = `${Math.round(abs)} ₽`;
  return `Δ ${sign}${body}`;
};

const pad = (n) => String(n).padStart(2, '0');

/** «2026-10-23» в местном времени. */
export const formatDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** «2026-10-23 14:05» в местном времени. */
export const formatDateTime = (date) => `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** «2026-10-23_1405» — для имени папки (на Windows нет «:»). */
export const formatStamp = (date) => `${formatDate(date)}_${pad(date.getHours())}${pad(date.getMinutes())}`;

/** Сравнение |Δ| по убыванию; пустые суммы — в конец. */
export const byMoneyDesc = (a, b) => Math.abs(Number(b ?? 0)) - Math.abs(Number(a ?? 0));
