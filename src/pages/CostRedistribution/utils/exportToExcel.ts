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
import { cellBorderStyle, headerStyle, NUM_FMT_2 } from '../../../utils/excel/styles';
import { setFormula, writeSheetWithFrozenHeader } from '../../../utils/excel/sheetWriter';
import { computeSectionRanges, sumExcludingSections } from '../../../utils/excel/sectionSubtotals';

interface ExportData {
  rows: PreparedRow[];
  tenderTitle: string;
  // position_id → hierarchy_level (в серверных строках уровня нет).
  hierarchyLevels?: Map<string, number>;
}

export function exportRedistributionToExcel(data: ExportData): void {
  const { rows: preparedRows, tenderTitle, hierarchyLevels } = data;

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
      isAdditional: resultRow.is_additional,
      hierarchyLevel: hierarchyLevels?.get(resultRow.position_id) ?? 0,
      isZeroCost,
      isSectionItemNo: /^\d+\.?$/.test((resultRow.item_no || '').trim()),
      // Нужны для выбора ссылки на количество в Excel-формулах: делитель на
      // странице — quantity = manual_volume || client_volume || 1
      // (buildResultRows.ts). Формула должна ссылаться на ту же колонку.
      manualVolume: resultRow.manual_volume ?? 0,
      clientVolume: resultRow.client_volume ?? 0,
      totalMaterials,
      totalWorksAfter,
    };
  };

  const rows = orderedRows.map(createRow);

  // Рассчитываем итоги
  const totalMaterialsSum = rows.reduce((sum, row) => sum + row.totalMaterials, 0);
  const totalWorksSum = rows.reduce((sum, row) => sum + row.totalWorksAfter, 0);
  const totals = [
    '',
    'ИТОГО:',
    '',
    '',
    '',
    '',
    '',
    totalMaterialsSum,
    totalWorksSum,
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
      ...cellBorderStyle,
      top: { style: 'medium', color: { rgb: '000000' } },
      bottom: { style: 'medium', color: { rgb: '000000' } },
    },
  };

  // Индексы числовых колонок (для числового формата)
  // Кол-во заказчика, Кол-во ГП, Цена за ед мат-ал, Цена за ед раб, Итого материалы, Итого работы
  const numericColIndices = [2, 3, 5, 6, 7, 8];
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
    const isNumericTotal = numericColIndices.includes(col);
    ws[cellAddress].s = isNumericTotal ? { ...totalStyle, numFmt: NUM_FMT_2 } : totalStyle;

    // Числовой формат задан через .s.numFmt (xlsx-js-style игнорирует .z при наличии .s)
    if (isNumericTotal) {
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
        ...(isNumeric && { numFmt: NUM_FMT_2 }),
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

      // Числовой формат задан через .s.numFmt выше — здесь только гарантируем тип 'n'
      if (isNumeric) {
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

  // ── Excel-формулы в колонках итогов (аудит расчёта в файле) ──
  // Итог = количество × цена за единицу. Ссылка на количество выбирается так же,
  // как делитель на странице: quantity = manual_volume || client_volume || 1.
  rows.forEach((row, i) => {
    const excelRow = i + 2; // 1-based, +1 из-за строки заголовка
    const qtyRef =
      row.manualVolume > 0 ? `D${excelRow}` : row.clientVolume > 0 ? `C${excelRow}` : '1';
    setFormula(ws, i + 1, 7, `${qtyRef}*F${excelRow}`, row.totalMaterials);
    setFormula(ws, i + 1, 8, `${qtyRef}*G${excelRow}`, row.totalWorksAfter);
  });

  // ── Промежуточные итоги по разделам (H/I = SUBTOTAL(9, потомки)) ──
  // ДОП-строки идут в конце листа — диапазоны считаем только по обычным.
  const regularCount = rows.filter((r) => !r.isAdditional).length;
  const subtotalCols: Array<[number, string, (r: (typeof rows)[number]) => number]> = [
    [7, 'H', (r) => r.totalMaterials],
    [8, 'I', (r) => r.totalWorksAfter],
  ];
  const sectionRanges = computeSectionRanges(
    rows.slice(0, regularCount),
    (i) => subtotalCols.some(([, , pick]) => pick(rows[i]) !== 0),
  );
  const sectionRowSet = new Set(sectionRanges.map((r) => r.rowIndex));
  for (const [col, letter, pick] of subtotalCols) {
    const values = rows.map(pick);
    for (const { rowIndex, startIdx, endIdx } of sectionRanges) {
      setFormula(
        ws,
        rowIndex + 1,
        col,
        `SUBTOTAL(9,${letter}${startIdx + 2}:${letter}${endIdx + 2})`,
        sumExcludingSections(values, sectionRowSet, startIdx, endIdx),
      );
    }
  }

  if (rows.length > 0) {
    const lastDataRow = rows.length + 1; // 1-based номер последней строки данных
    // Итог — SUBTOTAL(9): строки-разделы с SUBTOTAL не удваиваются.
    for (const [col, letter, pick] of subtotalCols) {
      const values = rows.map(pick);
      setFormula(
        ws,
        totalRowIndex,
        col,
        `SUBTOTAL(9,${letter}2:${letter}${lastDataRow})`,
        sumExcludingSections(values, sectionRowSet, 0, rows.length - 1),
      );
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

  // Заморозка первой строки делается пост-обработкой (injectFreezePane) —
  // xlsx-js-style 1.2.0 не поддерживает panes на запись.

  // Создаем workbook
  const wb = XLSX.utils.book_new();
  const sheetName = 'Результаты';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Генерируем имя файла
  const fileName = `Форма КП_${tenderTitle}.xlsx`;

  // Экспортируем
  writeSheetWithFrozenHeader(wb, sheetName, fileName);
}
