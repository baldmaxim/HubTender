/**
 * Утилита для экспорта результатов перераспределения в Excel
 *
 * Получает готовые строки из общего pipeline (src/services/redistributionPipeline),
 * чтобы не дублировать category-redistribution → position-adjustment → smartRound →
 * insurance. Страница «Перераспределение» = единый источник правды, экспорт лишь
 * рендерит уже посчитанные числа.
 */

import * as XLSX from 'xlsx-js-style';
import type { PreparedRow } from '../../../services/redistributionPipeline';

interface ExportData {
  rows: PreparedRow[];
  tenderTitle: string;
}

export function exportRedistributionToExcel(data: ExportData): void {
  const { rows: preparedRows, tenderTitle } = data;

  // Заголовок
  const header = [
    'Номер раздела',
    'Наименование',
    'Кол-во заказчика',
    'Кол-во ГП',
    'Ед. изм.',
    'Цена за ед. мат-ал в КП',
    'Цена за ед. раб',
    'Итого материалы',
    'Итого работы',
    'Примечание ГП',
  ];

  // Сортируем так же, как раньше: сначала обычные, затем ДОП.
  const orderedRows = [
    ...preparedRows.filter((r) => !r.is_additional),
    ...preparedRows.filter((r) => r.is_additional),
  ];

  const createRow = (resultRow: PreparedRow) => {
    const materialUnitPrice =
      Math.round((resultRow.rounded_material_unit_price ?? resultRow.material_unit_price ?? 0) * 100) / 100;
    const totalWorksAfter = resultRow.rounded_total_works ?? resultRow.total_works_after;
    const workUnitPriceAfter =
      resultRow.quantity > 0
        ? Math.round((totalWorksAfter / resultRow.quantity) * 100) / 100
        : 0;
    const totalMaterials = resultRow.rounded_total_materials ?? resultRow.total_materials;

    let fullName = '';
    if (resultRow.is_additional) {
      fullName = `  [ДОП] ${resultRow.work_name}`;
    } else {
      const sectionPrefix = resultRow.section_number ? `[${resultRow.section_number}] ` : '';
      fullName = `${sectionPrefix}${resultRow.work_name}`;
    }

    const totalCost = totalMaterials + totalWorksAfter;
    const isZeroCost = resultRow.isLeaf && totalCost === 0;

    return {
      data: [
        resultRow.item_no || '',
        fullName,
        resultRow.client_volume ?? '',
        resultRow.manual_volume ?? '',
        resultRow.unit_code,
        materialUnitPrice,
        workUnitPriceAfter,
        totalMaterials,
        totalWorksAfter,
        resultRow.manual_note || '',
      ],
      isLeaf: resultRow.isLeaf,
      isZeroCost,
      isSectionItemNo: /^\d+\.?$/.test((resultRow.item_no || '').trim()),
    };
  };

  const rows = orderedRows.map(createRow);

  // Рассчитываем итоги
  const totals = [
    '',
    'ИТОГО:',
    '',
    '',
    '',
    '',
    '',
    rows.reduce((sum, row) => sum + (row.data[7] as number), 0),
    rows.reduce((sum, row) => sum + (row.data[8] as number), 0),
    '',
  ];

  // Объединяем все данные
  const sheetData = [
    header,
    ...rows.map(row => row.data),
    totals,
  ];

  // Создаем worksheet
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Стили для заголовка таблицы
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

  // Стили для строки итогов
  const totalStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'E7E6E6' } },
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

  // Стиль границ для ячеек данных
  const cellBorderStyle = {
    top: { style: 'thin', color: { rgb: 'D3D3D3' } },
    bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
    left: { style: 'thin', color: { rgb: 'D3D3D3' } },
    right: { style: 'thin', color: { rgb: 'D3D3D3' } },
  };

  // Индексы числовых колонок (для числового формата)
  const numericColIndices = [5, 6, 7, 8]; // Цена за ед мат-ал, Цена за ед раб, Итого материалы, Итого работы
  const nameColIndex = 1; // Колонка "Наименование"

  // Применяем стили к заголовку (строка 0)
  for (let col = 0; col < header.length; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!ws[cellAddress]) continue;
    ws[cellAddress].s = headerStyle;
  }

  // Применяем стили к строке итогов
  const totalRowIndex = 1 + rows.length;
  for (let col = 0; col < totals.length; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: totalRowIndex, c: col });
    if (!ws[cellAddress]) continue;
    ws[cellAddress].s = totalStyle;

    // Применяем числовой формат к числовым колонкам в итогах
    if (numericColIndices.includes(col)) {
      ws[cellAddress].z = '# ##0.00';
      if (ws[cellAddress].v !== '' && ws[cellAddress].v !== null && ws[cellAddress].v !== undefined) {
        if (typeof ws[cellAddress].v === 'number') {
          ws[cellAddress].t = 'n';
        } else if (typeof ws[cellAddress].v === 'string') {
          const numValue = parseFloat(ws[cellAddress].v);
          if (!isNaN(numValue)) {
            ws[cellAddress].t = 'n';
            ws[cellAddress].v = numValue;
          }
        }
      }
    }
  }

  // Применяем стили к ячейкам данных
  for (let row = 1; row < 1 + rows.length; row++) {
    const rowData = rows[row - 1]; // Получаем метаданные строки
    const isZeroCostRow = rowData.isZeroCost;

    for (let col = 0; col < header.length; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      if (!ws[cellAddress]) ws[cellAddress] = { t: 's', v: '' };

      const isNumeric = numericColIndices.includes(col);

      // Базовый стиль с границами
      const baseStyle: Record<string, unknown> = {
        border: cellBorderStyle,
        alignment: {
          wrapText: true,
          vertical: 'center',
          horizontal: col === nameColIndex ? 'left' : 'center',
        },
      };

      // Добавляем бледно-красный фон для листовых строк с нулевой стоимостью
      if (isZeroCostRow) {
        baseStyle.fill = { fgColor: { rgb: 'FFCCCC' } };
      }

      if (col === 0 && rowData.isSectionItemNo) {
        baseStyle.fill = { fgColor: { rgb: 'D6E4FF' } };
        baseStyle.font = { bold: true };
      }

      ws[cellAddress].s = baseStyle;

      // Установить числовой формат для числовых колонок
      if (isNumeric) {
        ws[cellAddress].z = '# ##0.00';

        // Если ячейка не пустая, убедиться что это число
        if (ws[cellAddress].v !== '' && ws[cellAddress].v !== null && ws[cellAddress].v !== undefined) {
          if (typeof ws[cellAddress].v === 'number') {
            ws[cellAddress].t = 'n';
          } else if (typeof ws[cellAddress].v === 'string') {
            const numValue = parseFloat(ws[cellAddress].v);
            if (!isNaN(numValue)) {
              ws[cellAddress].t = 'n';
              ws[cellAddress].v = numValue;
            }
          }
        }
      }
    }
  }

  // Устанавливаем ширину колонок
  ws['!cols'] = [
    { wch: 15 }, // Номер раздела
    { wch: 40 }, // Наименование
    { wch: 15 }, // Кол-во заказчика
    { wch: 12 }, // Кол-во ГП
    { wch: 10 }, // Ед. изм.
    { wch: 20 }, // Цена за ед. мат-ал
    { wch: 18 }, // Цена за ед. раб (После)
    { wch: 18 }, // Итого материалы
    { wch: 18 }, // Итого работы (После)
    { wch: 30 }, // Примечание ГП
  ];

  // Установить высоту строки заголовка (для переноса текста)
  ws['!rows'] = [{ hpt: 40 }];

  // Заморозить первую строку (заголовки)
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  // Создаем workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Результаты');

  // Генерируем имя файла
  const fileName = `Форма КП_${tenderTitle}.xlsx`;

  // Экспортируем
  XLSX.writeFile(wb, fileName);
}
