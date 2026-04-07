/**
 * Экспорт данных коммерции в Excel
 */

import { message } from 'antd';
import * as XLSX from 'xlsx-js-style';
import type { Tender } from '../../../lib/supabase';
import type { PositionWithCommercialCost } from '../types';

export function exportCommerceToExcel(
  positions: PositionWithCommercialCost[],
  selectedTender: Tender | undefined,
  insuranceTotal: number = 0
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
  const getInsuranceShare = (pos: PositionWithCommercialCost) =>
    totalWorksBase > 0 ? insuranceTotal * ((pos.work_cost_total ?? 0) / totalWorksBase) : 0;

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
    };
  });

  const rows = rowsWithMeta.map(r => r.data);

  // Рассчитываем итоги
  const totalBase = positions.reduce((sum, pos) => sum + (pos.base_total || 0), 0);
  const totalMaterials = positions.reduce((sum, pos) => sum + (pos.material_cost_total ?? 0), 0);
  const totalWorks = positions.reduce((sum, pos) => sum + (pos.work_cost_total ?? 0), 0) + insuranceTotal;
  const totalCommercial = totalMaterials + totalWorks;
  const avgMarkup = totalBase > 0 ? ((totalCommercial - totalBase) / totalBase) * 100 : 0;

  // Итоговая строка
  const totals = [
    '',
    '',
    'ИТОГО',
    '',
    '',
    '',
    positions.reduce((sum, pos) => sum + (pos.manual_volume || 0), 0),
    positions.reduce((sum, pos) => sum + (pos.items_count || 0), 0),
    totalBase,
    totalMaterials,
    totalWorks,
    totalCommercial,
    Number(avgMarkup.toFixed(2)),
    0,
    0,
    0,
  ];

  // Создаем массив данных
  const sheetData = [headers, ...rows, totals];

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
      const baseStyle: any = {
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

      if (col === 0 && rowMeta.isSectionItemNo) {
        baseStyle.fill = { fgColor: { rgb: 'D6E4FF' } };
        baseStyle.font = { bold: true };
      }

      // Красный текст для колонки "Количество (ГП)" если объёмы совпадают
      if (col === 6 && rowMeta.volumesMatch) {
        baseStyle.font = { color: { rgb: 'FF4D4F' }, bold: true };
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

  // Заморозить первую строку (заголовки)
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  // Создаем книгу Excel
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Коммерческие стоимости');

  // Сохраняем файл
  const fileName = selectedTender
    ? `Коммерческие стоимости_${selectedTender.title} (v${selectedTender.version}).xlsx`
    : 'Коммерческие стоимости.xlsx';
  XLSX.writeFile(wb, fileName);

  message.success(`Данные экспортированы в файл ${fileName}`);
}
