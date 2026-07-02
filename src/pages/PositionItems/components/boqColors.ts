import type { BoqItemType, CurrencyType } from '../../../lib/types';

/** Символы валют для отображения цены/итогов. */
export const currencySymbols: Record<CurrencyType, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  CNY: '¥',
};

/** Признак материала (мат/суб-мат/мат-комп.). */
export const isMaterialType = (t: BoqItemType): boolean =>
  t === 'мат' || t === 'суб-мат' || t === 'мат-комп.';

/** Цвет тега типа элемента BOQ (фон/текст) — общий для таблицы и карточек. */
export function getBoqTypeTagStyle(itemType: BoqItemType): { bgColor: string; textColor: string } {
  switch (itemType) {
    case 'раб':
      return { bgColor: 'rgba(239, 108, 0, 0.12)', textColor: '#f57c00' };
    case 'суб-раб':
      return { bgColor: 'rgba(106, 27, 154, 0.12)', textColor: '#7b1fa2' };
    case 'раб-комп.':
      return { bgColor: 'rgba(198, 40, 40, 0.12)', textColor: '#d32f2f' };
    case 'мат':
      return { bgColor: 'rgba(21, 101, 192, 0.12)', textColor: '#1976d2' };
    case 'суб-мат':
      return { bgColor: 'rgba(104, 159, 56, 0.12)', textColor: '#7cb342' };
    case 'мат-комп.':
      return { bgColor: 'rgba(0, 105, 92, 0.12)', textColor: '#00897b' };
    default:
      return { bgColor: '', textColor: '' };
  }
}
