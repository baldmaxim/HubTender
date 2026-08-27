/**
 * `formatter` для antd InputNumber «Цена за ед.».
 * У rc-input-number кастомный formatter ОБХОДИТ `precision` — значение из БД
 * с 3+ знаками показывалось бы как есть до первого blur. Поэтому вне ввода
 * округляем до 2 знаков сами; во время набора (userTyping) отдаём строку как есть,
 * чтобы не ломать ввод «12,3».
 */
export const formatPriceInput = (
  value: string | number | undefined,
  info?: { userTyping: boolean },
): string => {
  if (value == null || value === '') return '';
  const num = Number(value);
  const str = !info?.userTyping && Number.isFinite(num) ? num.toFixed(2) : `${value}`;
  return str.replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',');
};
