import type { ExportRow } from './types';

/**
 * Получает стиль для ячейки в зависимости от типа строки
 */
export function getCellStyle(row: ExportRow) {
  const baseStyle = {
    border: {
      top: { style: 'thin', color: { rgb: 'D3D3D3' } },
      bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
      left: { style: 'thin', color: { rgb: 'D3D3D3' } },
      right: { style: 'thin', color: { rgb: 'D3D3D3' } },
    },
    alignment: {
      wrapText: true,    // Перенос строк в ячейках
      vertical: 'center',  // Выравнивание по центру по вертикали
    },
  };

  // Для позиций заказчика
  if (row.isPosition) {
    // Красная подсветка ТОЛЬКО для листовых позиций БЕЗ BOQ items
    if (row.isLeaf && row.totalAmount === null) {
      return {
        ...baseStyle,
        fill: { fgColor: { rgb: 'FFCCCC' } },
      };
    }
    return baseStyle;
  }

  // Для BOQ items
  const colorMap: Record<string, string> = {
    'раб': 'FFE6CC',
    'суб-раб': 'E6D9F2',
    'раб-комп.': 'FFDDDD',
    'мат': 'D9EAFF',
    'суб-мат': 'E8F5E0',
    'мат-комп.': 'CCF2EF',
  };

  const color = row.boqItemType ? colorMap[row.boqItemType] : null;
  return color
    ? { ...baseStyle, fill: { fgColor: { rgb: color } } }
    : baseStyle;
}

/**
 * Стиль заголовков Excel
 */
export const headerStyle = {
  font: { bold: true },
  fill: { fgColor: { rgb: 'E0E0E0' } },
  alignment: {
    horizontal: 'center',
    vertical: 'center',
    wrapText: true  // Перенос текста в заголовках
  },
  border: {
    top: { style: 'thin', color: { rgb: 'D3D3D3' } },
    bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
    left: { style: 'thin', color: { rgb: 'D3D3D3' } },
    right: { style: 'thin', color: { rgb: 'D3D3D3' } },
  },
};

/**
 * Стиль границ ячейки
 */
export const cellBorderStyle = {
  top: { style: 'thin', color: { rgb: 'D3D3D3' } },
  bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
  left: { style: 'thin', color: { rgb: 'D3D3D3' } },
  right: { style: 'thin', color: { rgb: 'D3D3D3' } },
};

/**
 * Ширины колонок
 */
export const columnWidths = [
  { wch: 15 },  // Номер позиции
  { wch: 10 },  // № п/п
  { wch: 30 },  // Затрата на строительство
  { wch: 15 },  // Привязка материала к работе
  { wch: 12 },  // Тип элемента
  { wch: 12 },  // Тип материала
  { wch: 40 },  // Наименование
  { wch: 10 },  // Ед. изм.
  { wch: 15 },  // Количество заказчика
  { wch: 12 },  // Коэфф. перевода
  { wch: 12 },  // Коэфф. расхода
  { wch: 15 },  // Количество ГП
  { wch: 10 },  // Валюта
  { wch: 15 },  // Тип доставки
  { wch: 15 },  // Стоимость доставки
  { wch: 15 },  // Цена за единицу
  { wch: 15 },  // Итоговая сумма
  { wch: 20 },  // Ссылка на КП
  { wch: 25 },  // Примечание заказчика
  { wch: 25 },  // Примечание ГП
];

/**
 * Индексы колонок с числовыми значениями
 */
export const numericColIndices = [8, 9, 10, 11, 14, 15, 16];

/**
 * Индексы колонок с 4 знаками после запятой
 */
export const fourDecimalColIndices = [8, 9, 10, 11];

/**
 * Индекс колонки "Наименование" для левого выравнивания
 */
export const nameColIndex = 6;
