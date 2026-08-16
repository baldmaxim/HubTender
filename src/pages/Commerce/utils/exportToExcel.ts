/**
 * Экспорт данных коммерции в Excel
 */

import { message } from 'antd';
import * as XLSX from 'xlsx-js-style';
import type { Tender } from '../../../lib/types';
import type { PositionWithCommercialCost } from '../types';
import { cellBorderStyle, headerStyle, NUM_FMT_2 } from '../../../utils/excel/styles';
import { setFormula, writeSheetWithFrozenHeader } from '../../../utils/excel/sheetWriter';

export function exportCommerceToExcel(
  positions: PositionWithCommercialCost[],
  selectedTender: Tender | undefined,
  insuranceTotal: number = 0,
  distributeToRows: boolean = true
) {
  if (positions.length === 0) {
    message.warning('Нет данных для экспорта');
    return;
  }

  // Функция определения конечности позиции по hierarchy_level
  const isLeafPosition = (index: number): boolean => {
    if (index === positions.length - 1) {
      return true;
    }

    const currentLevel = positions[index].hierarchy_level || 0;
    const nextLevel = positions[index + 1]?.hierarchy_level || 0;

    return currentLevel >= nextLevel;
  };

  const totalWorksBase = positions.reduce((sum, pos) => sum + (pos.work_cost_total ?? 0), 0);
  // Если у позиции уже есть pre-computed insurance_share из общего pipeline
  // (страница «Перераспределение» = единый источник правды), используем его —
  // числа совпадут с CR. Иначе fallback на пропорциональное разнесение.
  const getInsuranceShare = (pos: PositionWithCommercialCost) => {
    // Разнесение выключено → доля страхования по строкам = 0 (в скалярный итог
    // экспорта страхование по-прежнему входит отдельной строкой).
    if (!distributeToRows) return 0;
    if (pos.insurance_share != null) return pos.insurance_share;
    return totalWorksBase > 0
      ? insuranceTotal * ((pos.work_cost_total ?? 0) / totalWorksBase)
      : 0;
  };

  // Заголовки колонок
  const headers = [
    'Номер раздела',
    'Номер позиции',
    'Название',
    'Примечание Заказчика',
    'Примечание ГП',
    'Единица',
    'Количество (ГП)',
    'Кол-во Заказчика',
    'Базовая стоимость',
    'Итого материалов (КП), руб',
    'Итого работ (КП), руб',
    'Коммерческая стоимость',
    'За единицу (база)',
    'За единицу (коммерч.)',
    'За единицу материалов',
    'За единицу работ',
  ];

  // Подготавливаем данные для экспорта с метаданными
  const rowsWithMeta = positions.map((pos, index) => {
    const isLeaf = isLeafPosition(index);
    const insuranceShare = getInsuranceShare(pos);
    const itemNo = (pos.item_no || '').trim();
    const gpVolume = pos.manual_volume || 0;
    const clientVolume = pos.volume || 0;
    const volumesMatch = gpVolume === clientVolume && gpVolume > 0;

    const materialCostTotal = pos.material_cost_total ?? 0;
    const workCostTotal = (pos.work_cost_total ?? 0) + insuranceShare;
    const materialUnitPrice = gpVolume > 0 ? Math.round(materialCostTotal / gpVolume * 100) / 100 : 0;
    const workUnitPrice = gpVolume > 0 ? Math.round(workCostTotal / gpVolume * 100) / 100 : 0;

    const commercialTotal = materialCostTotal + workCostTotal;
    const totalCost = commercialTotal;
    const isZeroCost = isLeaf && totalCost === 0;
    const commercialUnitPrice = gpVolume > 0 ? Math.round(commercialTotal / gpVolume * 100) / 100 : 0;

    return {
      data: [
        pos.item_no || '',
        pos.position_number,
        pos.work_name,
        pos.client_note || '',
        pos.manual_note || '',
        pos.unit_code || '',
        gpVolume,
        clientVolume,
        pos.base_total || 0,
        materialCostTotal,
        workCostTotal,
        commercialTotal,
        gpVolume > 0 ? Math.round((pos.base_total || 0) / gpVolume * 100) / 100 : 0,
        commercialUnitPrice,
        materialUnitPrice,
        workUnitPrice,
      ],
      isZeroCost,
      volumesMatch,
      isSectionItemNo: /^\d+\.?$/.test(itemNo),
      // Нужны для Excel-формул: при gpVolume = 0 цены за единицу тоже 0,
      // поэтому формулу «кол-во × цена» ставить нельзя — она обнулит суммы.
      gpVolume,
      materialCostTotal,
      workCostTotal,
      commercialTotal,
    };
  });

  const rows = rowsWithMeta.map(r => r.data);

  // Рассчитываем итоги
  const totalBase = positions.reduce((sum, pos) => sum + (pos.base_total || 0), 0);
  const totalMaterials = positions.reduce((sum, pos) => sum + (pos.material_cost_total ?? 0), 0);
  const totalWorks = positions.reduce((sum, pos) => sum + (pos.work_cost_total ?? 0), 0) + insuranceTotal;
  const totalCommercial = totalMaterials + totalWorks;
  const totalGpVolume = positions.reduce((sum, pos) => sum + (pos.manual_volume || 0), 0);
  const totalClientVolume = positions.reduce((sum, pos) => sum + (pos.volume || 0), 0);

  // Итоговая строка. Колонки «За единицу» не суммируются — усреднять цену по
  // разным единицам измерения бессмысленно.
  const totals = [
    '',
    '',
    'ИТОГО',
    '',
    '',
    '',
    totalGpVolume,
    totalClientVolume,
    totalBase,
    totalMaterials,
    totalWorks,
    totalCommercial,
    '',
    '',
    '',
    '',
  ];

  // Создаем массив данных
  const sheetData = [headers, ...rows, totals];

  // Создаем рабочий лист
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

  // Индексы числовых колонок
  const numericColIndices = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const nameColIndex = 2; // Колонка "Название"

  // Применяем стили к заголовку (строка 0)
  for (let col = 0; col < headers.length; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!ws[cellAddress]) continue;
    ws[cellAddress].s = headerStyle;
  }

  // Применяем стили к ячейкам данных
  for (let row = 1; row < 1 + rows.length; row++) {
    const rowMeta = rowsWithMeta[row - 1]; // Получаем метаданные строки
    const isZeroCostRow = rowMeta.isZeroCost;

    for (let col = 0; col < headers.length; col++) {
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

      if (col === 0 && rowMeta.isSectionItemNo) {
        baseStyle.fill = { fgColor: { rgb: 'D6E4FF' } };
        baseStyle.font = { bold: true };
      }

      // Красный текст для колонки "Количество (ГП)" если объёмы совпадают
      if (col === 6 && rowMeta.volumesMatch) {
        baseStyle.font = { color: { rgb: 'FF4D4F' }, bold: true };
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

  // ── Excel-формулы в колонках итогов (аудит расчёта в файле) ──
  // G — Количество (ГП), O — За единицу материалов, P — За единицу работ,
  // J — Итого материалов, K — Итого работ, L — Коммерческая стоимость (всего).
  rowsWithMeta.forEach((meta, i) => {
    const excelRow = i + 2; // 1-based, +1 из-за строки заголовка
    // При нулевом «Количество (ГП)» цены за единицу равны 0, а суммы могут быть
    // ненулевыми — формула затёрла бы их, поэтому оставляем литералы.
    if (meta.gpVolume > 0) {
      setFormula(ws, i + 1, 9, `G${excelRow}*O${excelRow}`, meta.materialCostTotal);
      setFormula(ws, i + 1, 10, `G${excelRow}*P${excelRow}`, meta.workCostTotal);
    }
    setFormula(ws, i + 1, 11, `J${excelRow}+K${excelRow}`, meta.commercialTotal);
  });

  if (rows.length > 0) {
    const lastDataRow = rows.length + 1; // 1-based номер последней строки данных
    const sums: Array<[number, string, number]> = [
      [6, 'G', totalGpVolume],
      [7, 'H', totalClientVolume],
      [8, 'I', totalBase],
      [9, 'J', totalMaterials],
      [10, 'K', totalWorks],
      [11, 'L', totalCommercial],
    ];
    for (const [col, letter, cached] of sums) {
      setFormula(ws, totalRowIndex, col, `SUM(${letter}2:${letter}${lastDataRow})`, cached);
    }
  }

  // Устанавливаем ширину колонок
  ws['!cols'] = [
    { wch: 15 }, // Номер раздела
    { wch: 15 }, // Номер позиции
    { wch: 40 }, // Название
    { wch: 30 }, // Примечание Заказчика
    { wch: 30 }, // Примечание ГП
    { wch: 10 }, // Единица
    { wch: 15 }, // Количество (ГП)
    { wch: 15 }, // Кол-во Заказчика
    { wch: 18 }, // Базовая стоимость
    { wch: 20 }, // Итого материалов
    { wch: 20 }, // Итого работ
    { wch: 20 }, // Коммерческая стоимость
    { wch: 18 }, // За единицу (база)
    { wch: 18 }, // За единицу (коммерч.)
    { wch: 20 }, // За единицу материалов
    { wch: 18 }, // За единицу работ
  ];

  // Установить высоту строки заголовка (для переноса текста)
  ws['!rows'] = [{ hpt: 40 }];

  // Заморозка первой строки делается пост-обработкой (injectFreezePane) —
  // xlsx-js-style 1.2.0 не поддерживает panes на запись.

  // Создаем книгу Excel
  const wb = XLSX.utils.book_new();
  const sheetName = 'Коммерческие стоимости';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Сохраняем файл
  const fileName = selectedTender
    ? `Коммерческие стоимости_${selectedTender.title} (v${selectedTender.version}).xlsx`
    : 'Коммерческие стоимости.xlsx';
  writeSheetWithFrozenHeader(wb, sheetName, fileName);

  message.success(`Данные экспортированы в файл ${fileName}`);
}
