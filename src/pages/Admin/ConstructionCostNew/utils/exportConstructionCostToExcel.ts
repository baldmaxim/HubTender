/**
 * Утилита экспорта затрат на строительство в Excel
 * Создает файл с двумя типами затрат (прямые и коммерческие) в одной таблице.
 * Разнесена по модулям ≤500 строк: fetchOppositeCosts.ts (загрузка
 * противоположного типа затрат), buildExportRows.ts (сборка AoA-строк),
 * sortDetailRows.ts (доменные порядки сортировки, общие со страницей).
 */

import * as XLSX from 'xlsx-js-style';
import dayjs from 'dayjs';
import { message } from 'antd';
import { getErrorMessage } from '../../../../utils/errors';
import type { CostRow } from '../hooks/useCostData';
import { fetchOppositeCosts } from './fetchOppositeCosts';
import { buildExportData, type RowType } from './buildExportRows';

interface ExportParams {
  selectedTenderId: string;
  selectedTenderTitle: string;
  selectedVersion: number | null;
  costType: 'base' | 'commercial';
  filteredData: CostRow[];
  areaSp: number;
}

/**
 * Настройка стилей и структуры листа Excel
 */
function configureWorksheet(ws: XLSX.WorkSheet, rowTypes: RowType[]): void {
  // Ширина колонок
  ws['!cols'] = [
    { wch: 50 },
    { wch: 20 },
    { wch: 12 },
    { wch: 10 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 18 },
    { wch: 20 },
    { wch: 18 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 18 },
    { wch: 20 },
    { wch: 18 },
    { wch: 25 },
  ];

  // Объединение ячеек в заголовке
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, // Затрата тендера
    { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } }, // Комментарий
    { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } }, // Объем
    { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } }, // Ед. изм.
    { s: { r: 0, c: 4 }, e: { r: 0, c: 15 } }, // Прямые Затраты
    { s: { r: 0, c: 16 }, e: { r: 0, c: 28 } }, // Коммерческие Затраты
  ];

  // Применение стилей к ячейкам
  const beigeHeaderFill = { fgColor: { rgb: 'F5F5DC' } };
  const yellowCategoryFill = { fgColor: { rgb: 'FFFFE0' } };
  const greenSuperFill = { fgColor: { rgb: 'D4EDDA' } };
  const whiteFill = { fgColor: { rgb: 'FFFFFF' } };
  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  };

  // Применяем стили к каждой ячейке
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let R = range.s.r; R <= range.e.r; ++R) {
    const rowType = rowTypes[R];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[cellAddress]) continue;

      let fill = whiteFill;
      if (rowType === 'header' || rowType === 'subheader') {
        fill = beigeHeaderFill;
      } else if (rowType === 'supergroup') {
        fill = greenSuperFill;
      } else if (rowType === 'category' || rowType === 'location') {
        fill = yellowCategoryFill;
      }

      // Выравнивание
      const alignment: Record<string, unknown> = { vertical: 'center' };
      if (rowType === 'header' || rowType === 'subheader') {
        alignment.horizontal = 'center';
      } else if (C === 1) {
        // Столбец "Локализация" - центральное выравнивание
        alignment.horizontal = 'center';
      } else {
        alignment.horizontal = C === 0 ? 'left' : 'right';
      }

      // Формат чисел для колонок начиная с C (индекс 2)
      let numFmt = undefined;
      if (C >= 2 && rowType !== 'header' && rowType !== 'subheader') {
        // Для колонки объёма (C, индекс 2) — формат с дробной частью
        numFmt = C === 2 ? '#,##0.00' : '#,##0';
      }

      // Жирный шрифт и цвет
      const font: Record<string, unknown> = {};
      if (rowType === 'header' || rowType === 'subheader') {
        font.bold = true;
      } else if (rowType === 'supergroup' || rowType === 'category' || rowType === 'location') {
        font.bold = true;
      }

      // Зеленый цвет и жирный шрифт для столбцов "Итого за единицу" (индексы 15, 27, 28)
      if ((C === 15 || C === 27 || C === 28) && rowType !== 'header' && rowType !== 'subheader') {
        font.color = { rgb: '008000' };
        font.bold = true;
      }

      ws[cellAddress].s = {
        fill,
        border: thinBorder,
        alignment,
        ...(numFmt && { numFmt }),
        ...(Object.keys(font).length > 0 && { font }),
      };
    }
  }
}

/**
 * Основная функция экспорта затрат в Excel
 */
export async function exportConstructionCostToExcel(
  params: ExportParams
): Promise<void> {
  const {
    selectedTenderId,
    selectedTenderTitle,
    selectedVersion,
    costType,
    filteredData,
    areaSp,
  } = params;

  if (!selectedTenderId || !selectedTenderTitle) {
    message.warning('Выберите тендер для экспорта');
    return;
  }

  try {
    // Получаем данные для противоположного типа затрат
    const oppositeCostMap = await fetchOppositeCosts(selectedTenderId, costType);

    // Формируем данные для экспорта
    const { data: exportData, rowTypes } = buildExportData(
      filteredData,
      oppositeCostMap,
      areaSp,
      costType
    );

    // Создаем рабочую книгу и лист
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(exportData);

    // Настраиваем стили и структуру
    configureWorksheet(ws, rowTypes);

    // Добавляем лист в книгу
    XLSX.utils.book_append_sheet(wb, ws, 'Затраты');

    // Формируем имя файла
    const costTypeLabel = costType === 'base' ? 'Прямые' : 'Коммерческие';
    const fileName = `Затраты_${selectedTenderTitle}_v${selectedVersion || 1}_${costTypeLabel}_${dayjs().format('DD-MM-YYYY')}.xlsx`;

    // Экспортируем файл
    XLSX.writeFile(wb, fileName);
    message.success('Файл успешно экспортирован');
  } catch (error) {
    console.error('Ошибка экспорта:', error);
    message.error('Ошибка экспорта: ' + getErrorMessage(error));
  }
}
