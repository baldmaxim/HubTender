/**
 * Экспорт финансовых показателей в Excel
 */

import { message } from 'antd';
import * as XLSX from 'xlsx-js-style';
import type { IndicatorRow } from '../hooks/useFinancialData';

export function exportFinancialIndicatorsToExcel(
  data: IndicatorRow[],
  spTotal: number,
  customerTotal: number,
  tenderTitle: string,
  tenderVersion: number
) {
  if (data.length === 0) {
    message.warning('Нет данных для экспорта');
    return;
  }

  // Заголовки колонок
  const headers = [
    '№ п/п',
    'Наименование',
    'коэф-ты',
    `Площадь по СП\n${spTotal.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} м²\nстоимость на 1м²`,
    `Площадь Заказчика\n${customerTotal.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} м²\nстоимость на 1м²`,
    'Итого\nитоговая стоимость',
  ];

  // Подготавливаем данные для экспорта
  const rows = data.map((row) => {
    // Для заголовочной строки показываем текст заголовка в колонках с площадями
    if (row.is_header) {
      return [
        row.row_number,
        row.indicator_name,
        row.coefficient || '',
        'стоимость на 1м²',
        'стоимость на 1м²',
        'итоговая стоимость',
      ];
    }

    // Для обычных строк форматируем числа
    return [
      row.row_number,
      row.indicator_name,
      row.coefficient || '',
      row.sp_cost !== undefined
        ? row.sp_cost.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
        : '',
      row.customer_cost !== undefined
        ? row.customer_cost.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
        : '',
      row.total_cost !== undefined
        ? row.total_cost.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
        : '',
    ];
  });

  // Создаем массив данных
  const sheetData = [headers, ...rows];

  // Создаем рабочий лист
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Стили для заголовка
  const headerStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'E0E0E0' } },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
      wrapText: true,
    },
    border: {
      top: { style: 'thin', color: { rgb: 'D3D3D3' } },
      bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
      left: { style: 'thin', color: { rgb: 'D3D3D3' } },
      right: { style: 'thin', color: { rgb: 'D3D3D3' } },
    },
  };

  // Стиль для строки заголовка данных (первая строка в data с is_header)
  const dataHeaderStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'E6F7FF' } },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
      wrapText: true,
    },
    border: {
      top: { style: 'thin', color: { rgb: 'D3D3D3' } },
      bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
      left: { style: 'thin', color: { rgb: 'D3D3D3' } },
      right: { style: 'thin', color: { rgb: 'D3D3D3' } },
    },
  };

  // Стиль для строки итогов (ИТОГО)
  const totalStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'F0F0F0' } },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
      wrapText: true,
    },
    border: {
      top: { style: 'medium', color: { rgb: '000000' } },
      bottom: { style: 'medium', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: 'D3D3D3' } },
      right: { style: 'thin', color: { rgb: 'D3D3D3' } },
    },
  };

  // Стиль для желтой строки (НДС)
  const yellowStyle = {
    fill: { fgColor: { rgb: 'FFF9E6' } },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
      wrapText: true,
    },
    border: {
      top: { style: 'thin', color: { rgb: 'D3D3D3' } },
      bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
      left: { style: 'thin', color: { rgb: 'D3D3D3' } },
      right: { style: 'thin', color: { rgb: 'D3D3D3' } },
    },
  };

  // Стиль границ для обычных ячеек данных
  const cellBorderStyle = {
    top: { style: 'thin', color: { rgb: 'D3D3D3' } },
    bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
    left: { style: 'thin', color: { rgb: 'D3D3D3' } },
    right: { style: 'thin', color: { rgb: 'D3D3D3' } },
  };

  // Применяем стили к заголовку таблицы (строка 0)
  for (let col = 0; col < headers.length; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!ws[cellAddress]) continue;
    ws[cellAddress].s = headerStyle;
  }

  // Применяем стили к строкам данных
  for (let row = 1; row < 1 + rows.length; row++) {
    const rowData = data[row - 1]; // Получаем данные строки

    for (let col = 0; col < headers.length; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      if (!ws[cellAddress]) ws[cellAddress] = { t: 's', v: '' };

      let cellStyle: Record<string, unknown>;

      // Определяем стиль в зависимости от типа строки
      if (rowData.is_header) {
        cellStyle = dataHeaderStyle;
      } else if (rowData.is_total && rowData.is_yellow) {
        // ИТОГО с желтой подсветкой - объединяем стили
        cellStyle = {
          font: { bold: true },
          fill: { fgColor: { rgb: 'FFF9E6' } },
          alignment: {
            horizontal: 'center',
            vertical: 'center',
            wrapText: true,
          },
          border: {
            top: { style: 'medium', color: { rgb: '000000' } },
            bottom: { style: 'medium', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: 'D3D3D3' } },
            right: { style: 'thin', color: { rgb: 'D3D3D3' } },
          },
        };
      } else if (rowData.is_total) {
        cellStyle = totalStyle;
      } else if (rowData.is_yellow) {
        cellStyle = yellowStyle;
      } else {
        // Обычная строка данных
        cellStyle = {
          border: cellBorderStyle,
          alignment: {
            wrapText: true,
            vertical: 'center',
            horizontal: col === 1 ? 'left' : 'center', // Наименование - влево, остальное - по центру
          },
        };
      }

      ws[cellAddress].s = cellStyle;
    }
  }

  // Устанавливаем ширину колонок
  ws['!cols'] = [
    { wch: 8 },  // № п/п
    { wch: 45 }, // Наименование
    { wch: 15 }, // коэф-ты
    { wch: 20 }, // Площадь по СП
    { wch: 20 }, // Площадь Заказчика
    { wch: 25 }, // Итого
  ];

  // Установить высоту строки заголовка (для переноса текста)
  ws['!rows'] = [{ hpt: 60 }];

  // Заморозить первую строку (заголовки)
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  // Создаем книгу Excel
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Финансовые показатели');

  // Сохраняем файл
  const fileName = `Финансовые показатели_${tenderTitle} (v${tenderVersion}).xlsx`;
  XLSX.writeFile(wb, fileName);

  message.success(`Данные экспортированы в файл ${fileName}`);
}
